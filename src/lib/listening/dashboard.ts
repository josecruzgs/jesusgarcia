import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import MentionModel from "@/lib/models/Mention";
import type { SessionUser } from "@/lib/auth/dal";

export type ListeningDigest = {
  projects: number;
  activeProjects: number;
  mentions30d: number;
  mentions24h: number;
  avgScore: number | null;
  negative30d: number;
  byPlatform: { name: string; count: number }[];
  topTopics: { name: string; count: number }[];
  latest: {
    id: string;
    entity: string;
    title: string;
    domain: string;
    platform: string;
    url: string;
    sentiment: string | null;
    publishedAt: string;
  }[];
  /** Proyecto con la peor lectura del período — el que pide atención. */
  worstProject: { id: string; name: string; avgScore: number } | null;
};

/**
 * Resumen de Viento (escucha) para el dashboard principal. Una sola pasada
 * agregada en vez de reusar el endpoint de stats por proyecto: acá interesa
 * el cruce de todos los proyectos DEL USUARIO, no el detalle de uno.
 *
 * Las menciones no llevan dueño —cuelgan del proyecto—, así que el alcance se
 * arma resolviendo primero sus proyectos y filtrando por esos ids.
 */
export async function getListeningDigest(user: SessionUser): Promise<ListeningDigest> {
  await dbConnect();

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const myProjects = (await ListeningProjectModel.find({ ownerId: user.objectId })
    .select("status")
    .lean()) as { _id: Types.ObjectId; status?: string }[];

  const projects = myProjects.length;
  const activeProjects = myProjects.filter((p) => p.status === "active").length;
  // Con la lista vacía, `$in: []` no matchea nada y todo el resumen sale en
  // cero — que es exactamente lo que hay que mostrarle a quien no tiene escucha.
  const mine = { projectId: { $in: myProjects.map((p) => p._id) } };

  const [agg, latestDocs, projectScores] = await Promise.all([
    MentionModel.aggregate([
      { $match: { ...mine, publishedAt: { $gte: d30 } } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                avgScore: { $avg: "$sentimentScore" },
                negative: { $sum: { $cond: [{ $eq: ["$sentiment", "negative"] }, 1, 0] } },
                last24h: { $sum: { $cond: [{ $gte: ["$publishedAt", d1] }, 1, 0] } },
              },
            },
          ],
          byPlatform: [
            { $group: { _id: "$platform", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 6 },
          ],
          topTopics: [
            { $unwind: "$topics" },
            { $group: { _id: "$topics", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 8 },
          ],
        },
      },
    ]),

    MentionModel.find({ ...mine, publishedAt: { $gte: d30 } })
      .sort({ publishedAt: -1 })
      .limit(6)
      .select("entity title text domain platform url sentiment publishedAt")
      .lean(),

    // Solo cuenta el promedio de proyectos con volumen suficiente: con dos
    // menciones, un -80 no significa nada y desplazaría al que sí importa.
    MentionModel.aggregate([
      { $match: { ...mine, publishedAt: { $gte: d30 }, sentimentScore: { $ne: null } } },
      { $group: { _id: "$projectId", avgScore: { $avg: "$sentimentScore" }, n: { $sum: 1 } } },
      { $match: { n: { $gte: 5 } } },
      { $sort: { avgScore: 1 } },
      { $limit: 1 },
    ]),
  ]);

  const facet = (agg?.[0] ?? {}) as Record<string, { _id: unknown; count: number }[]>;
  const totals = ((agg?.[0]?.totals ?? [])[0] ?? {}) as {
    total?: number;
    avgScore?: number;
    negative?: number;
    last24h?: number;
  };

  let worstProject: ListeningDigest["worstProject"] = null;
  const worst = projectScores?.[0] as { _id: unknown; avgScore: number } | undefined;
  if (worst) {
    const doc = await ListeningProjectModel.findById(worst._id).select("name").lean();
    if (doc) {
      worstProject = {
        id: String(worst._id),
        name: (doc as { name: string }).name,
        avgScore: Math.round(worst.avgScore),
      };
    }
  }

  const named = (rows: { _id: unknown; count: number }[] | undefined) =>
    (rows ?? []).map((r) => ({ name: String(r._id ?? "—"), count: r.count }));

  return {
    projects,
    activeProjects,
    mentions30d: totals.total ?? 0,
    mentions24h: totals.last24h ?? 0,
    avgScore: totals.avgScore ?? null,
    negative30d: totals.negative ?? 0,
    byPlatform: named(facet.byPlatform),
    topTopics: named(facet.topTopics),
    latest: (latestDocs as Record<string, unknown>[]).map((m) => ({
      id: String(m._id),
      entity: String(m.entity ?? ""),
      title: String(m.title || m.text || m.url || "").slice(0, 140),
      domain: String(m.domain || m.platform || ""),
      platform: String(m.platform ?? ""),
      url: String(m.url ?? ""),
      sentiment: (m.sentiment as string) ?? null,
      publishedAt: (m.publishedAt as Date)?.toISOString() ?? "",
    })),
    worstProject,
  };
}
