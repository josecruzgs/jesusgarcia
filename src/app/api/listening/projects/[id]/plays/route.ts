import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import ActionPlayModel, { PLAY_STATUSES } from "@/lib/models/ActionPlay";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { generateActionPlays, DEFAULT_PLAY_COUNT } from "@/lib/listening/plays";

type Params = { params: Promise<{ id: string }> };

/** Jugadas del proyecto, de la más nueva a la más vieja. */
export const GET = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const status = req.nextUrl.searchParams.get("status") ?? "";

  await dbConnect();
  await assertOwnedProject(user, id);

  const filter: Record<string, unknown> = { projectId: id };
  if (PLAY_STATUSES.includes(status as (typeof PLAY_STATUSES)[number])) filter.status = status;

  const [plays, counts] = await Promise.all([
    ActionPlayModel.find(filter).sort({ createdAt: -1 }).limit(200).lean(),
    // Los contadores salen de todas las jugadas, no del filtro: son las
    // pestañas, y una pestaña que muestra su propio conteo filtrado siempre
    // diría lo mismo que la lista que ya se está viendo.
    ActionPlayModel.aggregate<{ _id: string; count: number }>([
      { $match: { projectId: new Types.ObjectId(id) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  return NextResponse.json({
    plays,
    counts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
  });
});

/** Genera jugadas nuevas sobre lo que la escucha encontró. */
export const POST = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const count = Math.max(1, Math.min(30, Number(body.count) || DEFAULT_PLAY_COUNT));

  await dbConnect();
  await assertOwnedProject(user, id);

  const plays = await generateActionPlays(id, { count });

  return NextResponse.json({ plays }, { status: 201 });
});
