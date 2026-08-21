import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ExecutiveBriefModel from "@/lib/models/ExecutiveBrief";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { briefSchedule } from "@/lib/listening/briefSchedule";

type Params = { params: Promise<{ id: string }> };

/**
 * Historial de resúmenes ejecutivos del proyecto y el estado de la grilla de
 * ventanas de tres días: qué períodos ya se analizaron y cuáles faltan.
 *
 * Los dos viajan juntos porque la interfaz los pinta como una sola cosa —una
 * línea de tiempo donde cada ventana está hecha o pendiente— y pedirlos por
 * separado dejaría el panel a medio dibujar durante un instante.
 */
export const GET = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 60));

  await dbConnect();
  // Los briefs no llevan dueño: cuelgan del proyecto.
  await assertOwnedProject(user, id);

  const [briefs, schedule] = await Promise.all([
    ExecutiveBriefModel.find({ projectId: id }).sort({ createdAt: -1 }).limit(limit).lean(),
    briefSchedule(id),
  ]);

  return NextResponse.json({ briefs, schedule });
});

export const DELETE = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const briefId = req.nextUrl.searchParams.get("briefId");
  if (!briefId) return NextResponse.json({ error: "Falta briefId" }, { status: 400 });

  await dbConnect();
  await assertOwnedProject(user, id);

  await ExecutiveBriefModel.deleteOne({ _id: briefId, projectId: id });

  return NextResponse.json({ ok: true });
});
