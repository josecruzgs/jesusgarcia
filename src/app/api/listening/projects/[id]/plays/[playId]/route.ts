import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ActionPlayModel from "@/lib/models/ActionPlay";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";

type Params = { params: Promise<{ id: string; playId: string }> };

/**
 * Edita una jugada antes de ejecutarla: los textos de los comentarios, cuántas
 * cuentas participan, la reacción, o su estado (aprobar / descartar).
 *
 * Una jugada ya despachada no se toca: sus tareas ya existen y editarla acá
 * daría la falsa impresión de haber cambiado lo que se va a ejecutar.
 */
export const PATCH = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id, playId } = await params;
  const body = await req.json().catch(() => ({}));

  await dbConnect();
  await assertOwnedProject(user, id);

  const current = await ActionPlayModel.findOne({ _id: playId, projectId: id })
    .select("kind")
    .lean();
  if (!current) return NextResponse.json({ error: "Jugada no encontrada" }, { status: 404 });

  const update: Record<string, unknown> = {};

  if (Array.isArray(body.comments)) {
    update.comments = [
      ...new Set(
        body.comments.map((text: unknown) => String(text ?? "").trim()).filter(Boolean),
      ),
    ].slice(0, 30);
  }
  if (body.suggestedCount !== undefined) {
    update.suggestedCount = Math.max(1, Math.min(30, Number(body.suggestedCount) || 1));
  }

  // Una cuenta por texto: en las jugadas de comentario la cantidad de cuentas
  // no se edita, se deriva. Así no hay forma de guardar un estado en el que la
  // campaña tendría que repetir un texto — ni desde la interfaz ni con un
  // PATCH escrito a mano.
  if (current.kind === "comment") {
    const comments = (update.comments as string[] | undefined) ?? null;
    if (comments) {
      if (comments.length === 0) {
        return NextResponse.json(
          { error: "Una jugada de comentario necesita al menos un texto" },
          { status: 400 },
        );
      }
      update.suggestedCount = comments.length;
    } else {
      delete update.suggestedCount;
    }
  }
  if (typeof body.reaction === "string") update.reaction = body.reaction;
  if (typeof body.headline === "string" && body.headline.trim()) {
    update.headline = body.headline.trim();
  }
  if (body.status === "approved" || body.status === "discarded" || body.status === "suggested") {
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const play = await ActionPlayModel.findOneAndUpdate(
    { _id: playId, projectId: id, status: { $ne: "dispatched" } },
    { $set: update },
    { new: true },
  ).lean();

  if (!play) {
    return NextResponse.json(
      { error: "La jugada no existe o ya se ejecutó" },
      { status: 404 },
    );
  }

  return NextResponse.json({ play });
});

export const DELETE = withAuth(async (user, _req: NextRequest, { params }: Params) => {
  const { id, playId } = await params;

  await dbConnect();
  await assertOwnedProject(user, id);

  await ActionPlayModel.deleteOne({ _id: playId, projectId: id });

  return NextResponse.json({ ok: true });
});
