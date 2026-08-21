import { normalize } from "./match";

/**
 * Identidad estable de una figura dentro de un proyecto.
 *
 * Existe porque las menciones se deduplican por (proyecto + figura + URL) y
 * durante mucho tiempo la parte "figura" fue el nombre visible. Con eso,
 * renombrar a alguien — "Marina del Pilar Ávila Olmeda" → "Marina del Pilar",
 * pasando el nombre largo a alias — cambiaba la clave de todo su historial: la
 * corrida siguiente volvía a guardar cada nota que ya estaba, ahora bajo el
 * nombre nuevo, y el feed mostraba la misma nota dos veces.
 *
 * `key` se asigna una vez y ya no cambia, así el nombre se puede editar
 * libremente sin partir el historial.
 */
export type EntityInput = {
  key?: string;
  name: string;
  aliases?: string[];
  profiles?: string[];
};

export type ResolvedEntity = {
  key: string;
  name: string;
  aliases: string[];
  profiles: string[];
};

export class DuplicateEntityError extends Error {}

function slugify(name: string): string {
  const base = normalize(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "figura";
}

/** Nombre + alias, normalizados, sin vacíos ni repetidos. */
function phrasesOf(entity: EntityInput): string[] {
  const all = [entity.name, ...(entity.aliases ?? [])]
    .map((p) => normalize(String(p ?? "").trim()))
    .filter(Boolean);
  return [...new Set(all)];
}

/**
 * Completa las claves que falten sin tocar las existentes. Los proyectos
 * creados antes de que existiera `key` entran por acá y reciben el slug de su
 * nombre actual — el mismo que usa el script de reparación, para que las
 * menciones ya migradas sigan casando.
 */
export function assignEntityKeys(entities: EntityInput[]): ResolvedEntity[] {
  const used = new Set(entities.map((e) => e.key).filter(Boolean) as string[]);

  return entities.map((entity) => {
    let key = entity.key;
    if (!key) {
      const base = slugify(entity.name);
      key = base;
      for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
      used.add(key);
    }
    return {
      key,
      name: String(entity.name ?? "").trim(),
      aliases: (entity.aliases ?? []).map((a) => String(a).trim()).filter(Boolean),
      profiles: (entity.profiles ?? []).map((p) => String(p).trim()).filter(Boolean),
    };
  });
}

/**
 * Valida y normaliza las figuras que llegan del formulario.
 *
 * Rechaza que la misma persona quede cargada dos veces: si el nombre de una
 * figura ya es el nombre o el alias de otra, ambas traen exactamente las
 * mismas menciones y el share of voice se parte en dos mitades que suman el
 * doble del volumen real. Es más útil frenarlo al guardar que explicar después
 * por qué los números no cuadran.
 */
export function normalizeEntities(raw: EntityInput[]): ResolvedEntity[] {
  const entities = assignEntityKeys(raw).filter((e) => e.name);

  const owner = new Map<string, ResolvedEntity>();
  for (const entity of entities) {
    const name = normalize(entity.name);

    const conflict = owner.get(name);
    if (conflict) {
      throw new DuplicateEntityError(
        `«${entity.name}» y «${conflict.name}» son la misma figura. ` +
          `Déjala una sola vez y pon el otro nombre como alias, o traerá cada mención duplicada.`,
      );
    }

    // El alias propio que repite el nombre no aporta y ensucia las búsquedas.
    entity.aliases = entity.aliases.filter((a) => normalize(a) !== name);

    for (const phrase of phrasesOf(entity)) {
      if (!owner.has(phrase)) owner.set(phrase, entity);
    }
  }

  return entities;
}

/**
 * A qué figura pertenece un nombre suelto: primero por nombre exacto, después
 * por alias. Lo usa la reparación para saber que las menciones guardadas con
 * el nombre viejo son de la figura que hoy lo lleva como alias.
 */
export function resolveEntityKey(name: string, entities: ResolvedEntity[]): string | null {
  const target = normalize(name.trim());
  if (!target) return null;

  const byName = entities.find((e) => normalize(e.name) === target);
  if (byName) return byName.key;

  const byAlias = entities.find((e) => e.aliases.some((a) => normalize(a) === target));
  return byAlias?.key ?? null;
}
