import { config } from "dotenv";
config({ path: ".env.local" });

import mongoose from "mongoose";
import { canonicalUrl, mentionHash, normalize } from "../lib/listening/match";
import { assignEntityKeys, resolveEntityKey, type ResolvedEntity } from "../lib/listening/entities";

/**
 * Repara los proyectos creados antes de que las figuras tuvieran clave estable.
 *
 * Hasta entonces las menciones se deduplicaban por nombre visible, así que
 * renombrar a alguien —o cargarlo dos veces con nombres distintos— hacía que la
 * corrida siguiente reingresara todo su historial bajo la etiqueta nueva. El
 * resultado es el mismo post apareciendo dos veces en el feed, una por nombre.
 *
 * Este script:
 *   1. asigna `key` a las figuras que no la tengan,
 *   2. atribuye cada mención a la figura que hoy lleva ese nombre o ese alias,
 *   3. borra las copias sobrantes de una misma URL DENTRO de cada figura,
 *   4. rehashea las supervivientes con la clave nueva.
 *
 * Lo que NO toca: la misma URL guardada para dos figuras distintas de verdad.
 * Una nota que habla de cuatro candidatos debe contar una vez para cada uno —
 * de ahí sale el share of voice.
 *
 *   npm run listening:repair          (simulación)
 *   npm run listening:repair -- --apply
 */

const APPLY = process.argv.includes("--apply");

type MentionDoc = {
  _id: unknown;
  entity: string;
  entityKey?: string;
  url: string;
  hash: string;
  analyzedAt?: Date | null;
  relevant?: boolean | null;
  createdAt?: Date;
};

/** Cuál copia conservar: la que ya costó tokens analizar y, a igualdad, la más vieja. */
function score(m: MentionDoc): number {
  return (m.analyzedAt ? 2 : 0) + (m.relevant === true ? 1 : 0);
}

function best(copies: MentionDoc[]): MentionDoc {
  return [...copies].sort((a, b) => {
    const byScore = score(b) - score(a);
    if (byScore !== 0) return byScore;
    return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
  })[0];
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const db = mongoose.connection.db!;
  const projectsCol = db.collection("listeningprojects");
  const mentionsCol = db.collection("mentions");

  if (!APPLY) console.log("— SIMULACIÓN — corre con --apply para escribir\n");

  for (const project of await projectsCol.find({}).toArray()) {
    const projectId = String(project._id);
    console.log(`\n${project.name} · ${projectId}`);

    const entities = assignEntityKeys((project.entities ?? []) as ResolvedEntity[]);
    const needsKeys = (project.entities ?? []).some((e: { key?: string }) => !e.key);
    if (needsKeys) {
      console.log(`  claves: ${entities.map((e) => `${e.name} → ${e.key}`).join(", ")}`);
      if (APPLY) await projectsCol.updateOne({ _id: project._id }, { $set: { entities } });
    }

    const mentions = (await mentionsCol
      .find({ projectId: project._id })
      .project({ entity: 1, entityKey: 1, url: 1, hash: 1, analyzedAt: 1, relevant: 1, createdAt: 1 })
      .toArray()) as unknown as MentionDoc[];

    // Agrupadas por (figura real, URL canónica). Lo que cae en un mismo grupo
    // es literalmente el mismo dato repetido.
    const groups = new Map<string, { entityKey: string | null; copies: MentionDoc[] }>();
    const orphans = new Map<string, number>();

    for (const mention of mentions) {
      const resolved = resolveEntityKey(mention.entity, entities);
      if (!resolved) orphans.set(mention.entity, (orphans.get(mention.entity) ?? 0) + 1);

      // Una mención que ninguna figura reclama conserva su identidad actual:
      // mezclarla con otra sería inventar una atribución que nadie pidió.
      const identity = resolved ?? `huerfana:${normalize(mention.entity)}`;
      // Separador \u0000 y no un espacio: los nombres de figura llevan espacios,
      // así que con uno "ana lopez|url" y "ana|lopez url" colisionarían. Un byte
      // nulo no aparece ni en una clave ni en una URL.
      const groupKey = `${identity}\u0000${canonicalUrl(mention.url)}`;

      const group = groups.get(groupKey) ?? { entityKey: resolved, copies: [] };
      group.copies.push(mention);
      groups.set(groupKey, group);
    }

    for (const [name, count] of orphans) {
      console.log(`  ⚠ "${name}" (${count} menciones) no coincide con ninguna figura ni alias`);
    }

    const doomed: unknown[] = [];
    const rewrite: { id: unknown; entityKey: string; entity: string; hash: string }[] = [];

    for (const { entityKey, copies } of groups.values()) {
      const keeper = best(copies);
      for (const copy of copies) if (copy !== keeper) doomed.push(copy._id);

      if (!entityKey) continue; // huérfana: se deja tal cual, solo se reporta

      const entity = entities.find((e) => e.key === entityKey)!;
      const hash = mentionHash(projectId, entityKey, keeper.url);
      if (keeper.hash !== hash || keeper.entityKey !== entityKey || keeper.entity !== entity.name) {
        rewrite.push({ id: keeper._id, entityKey, entity: entity.name, hash });
      }
    }

    console.log(
      `  menciones=${mentions.length} duplicadas_a_borrar=${doomed.length} a_reescribir=${rewrite.length}`,
    );

    if (APPLY) {
      // Primero borrar y después reescribir: el índice único (projectId, hash)
      // rechazaría al segundo de dos duplicados si se escribiera antes.
      if (doomed.length > 0) await mentionsCol.deleteMany({ _id: { $in: doomed as never[] } });
      for (const r of rewrite) {
        await mentionsCol.updateOne(
          { _id: r.id as never },
          { $set: { entityKey: r.entityKey, entity: r.entity, hash: r.hash } },
        );
      }
      const total = await mentionsCol.countDocuments({ projectId: project._id });
      await projectsCol.updateOne({ _id: project._id }, { $set: { mentionCount: total } });
      console.log(`  ✓ quedan ${total}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
