import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import MentionModel from "@/lib/models/Mention";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { escapeRegex } from "@/lib/regex";
import { parseDayRange } from "@/lib/listening/range";

export const GET = withAuth(async (user, req: NextRequest) => {
  const sp = req.nextUrl.searchParams;

  const projectId = sp.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Falta projectId" }, { status: 400 });

  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 25));

  await dbConnect();
  // Las menciones no llevan dueño: el alcance sale del proyecto al que cuelgan.
  await assertOwnedProject(user, projectId);

  const filter: Record<string, unknown> = { projectId };

  if (sp.get("from") || sp.get("to")) {
    const { from, to } = parseDayRange(sp.get("from"), sp.get("to"));
    filter.publishedAt = { $gte: from, $lte: to };
  }

  // "irrelevant" muestra solo lo descartado (para revisarlo antes de borrar);
  // sin el parámetro, lo descartado no aparece.
  const relevance = sp.get("relevance");
  if (relevance === "irrelevant") filter.relevant = false;
  else if (relevance !== "all") filter.relevant = { $ne: false };

  const sentiment = sp.get("sentiment");
  if (sentiment) filter.sentiment = sentiment;

  const entity = sp.get("entity");
  if (entity) filter.entity = entity;

  const platform = sp.get("platform");
  if (platform) filter.platform = platform;

  const sourceType = sp.get("sourceType");
  if (sourceType) filter.sourceType = sourceType;

  const search = sp.get("search")?.trim();
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    filter.$or = [{ title: rx }, { text: rx }, { author: rx }, { domain: rx }];
  }

  const [mentions, total] = await Promise.all([
    MentionModel.find(filter)
      .sort({ publishedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    MentionModel.countDocuments(filter),
  ]);

  return NextResponse.json({ mentions, total, page, pageSize });
});

/**
 * Borrado masivo. Solo actúa sobre lo que la IA marcó como ajeno a la figura
 * (`relevance=irrelevant`): un borrado sin ese acotamiento podría vaciar el
 * proyecto entero por un parámetro mal armado, y las menciones de redes
 * cuestan dinero real de volver a traer.
 */
export const DELETE = withAuth(async (user, req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Falta projectId" }, { status: 400 });

  if (sp.get("relevance") !== "irrelevant") {
    return NextResponse.json(
      { error: "Solo se pueden borrar en bloque las menciones marcadas como no relevantes" },
      { status: 400 },
    );
  }

  await dbConnect();
  await assertOwnedProject(user, projectId);

  const { deletedCount } = await MentionModel.deleteMany({ projectId, relevant: false });

  return NextResponse.json({ deleted: deletedCount ?? 0 });
});
