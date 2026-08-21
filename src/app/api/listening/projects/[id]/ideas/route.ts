import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ImageIdeaModel, { IDEA_KINDS } from "@/lib/models/ImageIdea";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { generateImageIdeas, DEFAULT_IDEA_COUNT } from "@/lib/listening/ideas";

type Params = { params: Promise<{ id: string }> };

/**
 * Ideas del proyecto. Las guardadas van primero: son las que el equipo eligió
 * conservar y tienen que seguir viéndose aunque se regenere el resto.
 */
export const GET = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const kind = req.nextUrl.searchParams.get("kind") ?? "";

  await dbConnect();
  await assertOwnedProject(user, id);

  const filter: Record<string, unknown> = { projectId: id };
  if (IDEA_KINDS.includes(kind as (typeof IDEA_KINDS)[number])) filter.kind = kind;

  const ideas = await ImageIdeaModel.find(filter)
    .sort({ kept: -1, createdAt: -1 })
    .limit(200)
    .lean();

  return NextResponse.json({ ideas });
});

/** Genera un lote nuevo de ideas (acciones y publicaciones). */
export const POST = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const count = Math.max(1, Math.min(20, Number(body.count) || DEFAULT_IDEA_COUNT));

  await dbConnect();
  await assertOwnedProject(user, id);

  const ideas = await generateImageIdeas(id, { count });

  return NextResponse.json({ ideas }, { status: 201 });
});
