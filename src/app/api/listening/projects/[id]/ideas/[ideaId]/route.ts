import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ImageIdeaModel from "@/lib/models/ImageIdea";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";

type Params = { params: Promise<{ id: string; ideaId: string }> };

/**
 * Edita una idea: guardarla (para que sobreviva a la próxima generación) o
 * ajustarle el texto y el borrador a mano.
 */
export const PATCH = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id, ideaId } = await params;
  const body = await req.json().catch(() => ({}));

  await dbConnect();
  await assertOwnedProject(user, id);

  const update: Record<string, unknown> = {};
  if (typeof body.kept === "boolean") update.kept = body.kept;
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim();
  if (typeof body.detail === "string" && body.detail.trim()) update.detail = body.detail.trim();
  if (typeof body.draft === "string") update.draft = body.draft.trim();

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const idea = await ImageIdeaModel.findOneAndUpdate(
    { _id: ideaId, projectId: id },
    { $set: update },
    { new: true },
  ).lean();

  if (!idea) return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });

  return NextResponse.json({ idea });
});

export const DELETE = withAuth(async (user, _req: NextRequest, { params }: Params) => {
  const { id, ideaId } = await params;

  await dbConnect();
  await assertOwnedProject(user, id);

  await ImageIdeaModel.deleteOne({ _id: ideaId, projectId: id });

  return NextResponse.json({ ok: true });
});
