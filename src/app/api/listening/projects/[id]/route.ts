import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import MentionModel from "@/lib/models/Mention";
import ExecutiveBriefModel from "@/lib/models/ExecutiveBrief";
import ActionPlayModel from "@/lib/models/ActionPlay";
import { withAuth } from "@/lib/apiHandler";
import {
  normalizeEntities,
  assignEntityKeys,
  DuplicateEntityError,
  type ResolvedEntity,
} from "@/lib/listening/entities";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (user, _req: NextRequest, { params }: Params) => {
  const { id } = await params;
  await dbConnect();

  const project = await ListeningProjectModel.findOne({ _id: id, ownerId: user.objectId }).lean();
  if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });

  return NextResponse.json({ project });
});

// Solo se aceptan campos de esta lista: un PATCH no debería poder tocar
// lastRunAt ni mentionCount, que los mantiene la ingesta.
const EDITABLE = [
  "name",
  "description",
  "entities",
  "includeTerms",
  "excludeTerms",
  "languages",
  "whitelistDomains",
  "blacklistDomains",
  "rssFeeds",
  "sources",
  "brightDataPlatforms",
  "autoAnalyze",
  "autoBrief",
  "status",
  "intervalMinutes",
] as const;

export const PATCH = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await req.json();

  const update: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (key in body) update[key] = body[key];
  }

  await dbConnect();

  let entities: ResolvedEntity[] | null = null;
  if ("entities" in update) {
    try {
      entities = normalizeEntities(update.entities as ResolvedEntity[]);
      update.entities = entities;
    } catch (err) {
      if (err instanceof DuplicateEntityError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const before = entities
    ? ((await ListeningProjectModel.findOne({ _id: id, ownerId: user.objectId })
        .select("entities")
        .lean()) as {
        entities: ResolvedEntity[];
      } | null)
    : null;

  const project = await ListeningProjectModel.findOneAndUpdate(
    { _id: id, ownerId: user.objectId },
    { $set: update },
    { new: true },
  ).lean();

  if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });

  // Renombrar una figura tiene que arrastrar su historial. Sin esto, el feed
  // mezclaría el nombre viejo en lo ya guardado y el nuevo en lo que entre
  // después — que es exactamente cómo se veía la duplicación antes de que las
  // figuras tuvieran clave estable.
  if (entities && before) {
    const previous = new Map(
      assignEntityKeys(before.entities ?? []).map((e) => [e.key, e.name] as const),
    );
    for (const entity of entities) {
      if (previous.get(entity.key) && previous.get(entity.key) !== entity.name) {
        await MentionModel.updateMany(
          { projectId: id, entityKey: entity.key },
          { $set: { entity: entity.name } },
        );
      }
    }
  }

  return NextResponse.json({ project });
});

export const DELETE = withAuth(async (user, _req: NextRequest, { params }: Params) => {
  const { id } = await params;
  await dbConnect();

  // Se borra el proyecto primero y solo se sigue si era de este usuario: las
  // menciones no llevan dueño, así que sin ese freno un id ajeno se llevaba
  // puestas las de otro.
  const deleted = await ListeningProjectModel.findOneAndDelete({ _id: id, ownerId: user.objectId });
  if (!deleted) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });

  // Todo lo que cuelga del proyecto se va con él: sin proyecto no hay forma de
  // consultarlo y quedaría ocupando espacio para siempre. Las jugadas ya
  // despachadas dejan atrás sus campañas a propósito — esas viven en Agua y
  // son historial de lo que efectivamente se ejecutó.
  await Promise.all([
    MentionModel.deleteMany({ projectId: id }),
    ExecutiveBriefModel.deleteMany({ projectId: id }),
    ActionPlayModel.deleteMany({ projectId: id }),
  ]);

  return NextResponse.json({ ok: true });
});
