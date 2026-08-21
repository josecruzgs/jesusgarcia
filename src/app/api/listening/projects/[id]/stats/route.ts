import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import MentionModel from "@/lib/models/Mention";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { parseDayRange, utcDayKeys } from "@/lib/listening/range";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;

  const { from, to } = parseDayRange(sp.get("from"), sp.get("to"));

  await dbConnect();
  await assertOwnedProject(user, id);

  // Las menciones que la IA marcó como ajenas a la figura se excluyen de
  // TODAS las métricas: si contaran, el sentimiento promedio y el volumen
  // reflejarían tortugas marinas en vez de la persona monitoreada.
  const includeIrrelevant = sp.get("includeIrrelevant") === "1";
  const match: Record<string, unknown> = {
    projectId: new Types.ObjectId(id),
    publishedAt: { $gte: from, $lte: to },
    ...(includeIrrelevant ? {} : { relevant: { $ne: false } }),
  };

  // Una sola pasada con $facet en vez de seis consultas: el filtro de fecha
  // es el mismo para todas y recorrer la colección una vez basta.
  const [facets] = await MentionModel.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              analyzed: { $sum: { $cond: [{ $ifNull: ["$analyzedAt", false] }, 1, 0] } },
              avgScore: { $avg: "$sentimentScore" },
              reach: { $sum: { $ifNull: ["$reach", 0] } },
              engagement: {
                $sum: {
                  $add: [
                    { $ifNull: ["$engagement.likes", 0] },
                    { $ifNull: ["$engagement.comments", 0] },
                    { $ifNull: ["$engagement.shares", 0] },
                  ],
                },
              },
            },
          },
        ],
        // Volumen y sentimiento por día, en UTC para que el agrupado no se
        // corra un día según la zona horaria del servidor.
        daily: [
          {
            $group: {
              _id: {
                day: { $dateToString: { format: "%Y-%m-%d", date: "$publishedAt", timezone: "UTC" } },
                sentiment: { $ifNull: ["$sentiment", "sin analizar"] },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.day": 1 } },
        ],
        bySentiment: [{ $group: { _id: { $ifNull: ["$sentiment", "sin analizar"] }, count: { $sum: 1 } } }],
        byEntity: [
          {
            $group: {
              _id: "$entity",
              count: { $sum: 1 },
              avgScore: { $avg: "$sentimentScore" },
            },
          },
          { $sort: { count: -1 } },
        ],
        bySource: [
          { $group: { _id: { $ifNull: ["$domain", "$platform"] }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
        // Por red social va con más detalle que el resto: es el desglose que
        // responde "¿de dónde me está llegando el dato y cómo viene?".
        byPlatform: [
          {
            $group: {
              _id: "$platform",
              count: { $sum: 1 },
              avgScore: { $avg: "$sentimentScore" },
              reach: { $sum: { $ifNull: ["$reach", 0] } },
              engagement: {
                $sum: {
                  $add: [
                    { $ifNull: ["$engagement.likes", 0] },
                    { $ifNull: ["$engagement.comments", 0] },
                    { $ifNull: ["$engagement.shares", 0] },
                  ],
                },
              },
              lastAt: { $max: "$publishedAt" },
            },
          },
          { $sort: { count: -1 } },
        ],
        topTopics: [
          { $unwind: "$topics" },
          { $group: { _id: "$topics", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 12 },
        ],
        topAuthors: [
          { $match: { author: { $nin: [null, ""] } } },
          {
            $group: {
              _id: "$author",
              count: { $sum: 1 },
              followers: { $max: "$authorFollowers" },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
      },
    },
  ]);

  type Row = {
    _id: unknown;
    count: number;
    avgScore?: number;
    followers?: number;
    reach?: number;
    engagement?: number;
    lastAt?: Date;
  };
  const facetData = (facets ?? {}) as Record<string, Row[]>;

  // La serie se rellena día por día: sin esto, un día sin menciones no
  // aparece y la gráfica dibuja una línea recta entre dos fechas lejanas,
  // escondiendo justamente el silencio.
  const dayKeys = utcDayKeys(from, to);

  const dailyMap = new Map(
    dayKeys.map((day) => [
      day,
      { day, total: 0, positive: 0, neutral: 0, negative: 0, unanalyzed: 0 },
    ]),
  );

  for (const row of facetData.daily ?? []) {
    const key = (row._id as { day: string }).day;
    const entry = dailyMap.get(key);
    if (!entry) continue;
    const sentiment = (row._id as { sentiment: string }).sentiment;
    entry.total += row.count;
    if (sentiment === "positive") entry.positive += row.count;
    else if (sentiment === "negative") entry.negative += row.count;
    else if (sentiment === "neutral") entry.neutral += row.count;
    else entry.unanalyzed += row.count;
  }

  const totals = (facetData.totals?.[0] ?? {}) as {
    total?: number;
    analyzed?: number;
    avgScore?: number;
    reach?: number;
    engagement?: number;
  };

  const named = (rows: Row[] | undefined) =>
    (rows ?? []).map((r) => ({
      name: String(r._id ?? "—"),
      count: r.count,
      avgScore: r.avgScore ?? null,
      followers: r.followers ?? null,
      reach: r.reach ?? 0,
      engagement: r.engagement ?? 0,
      lastAt: r.lastAt ?? null,
    }));

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      total: totals.total ?? 0,
      analyzed: totals.analyzed ?? 0,
      avgScore: totals.avgScore ?? null,
      reach: totals.reach ?? 0,
      engagement: totals.engagement ?? 0,
    },
    daily: dayKeys.map((day) => dailyMap.get(day)!),
    bySentiment: named(facetData.bySentiment),
    byEntity: named(facetData.byEntity),
    bySource: named(facetData.bySource),
    byPlatform: named(facetData.byPlatform),
    topTopics: named(facetData.topTopics),
    topAuthors: named(facetData.topAuthors),
  });
});
