import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import { ownerFilter } from "@/lib/auth/dal";
import GroupPostImageModel from "@/lib/models/GroupPostImage";
import TaskModel from "@/lib/models/Task";

/**
 * Borra una imagen que el operador quitó del formulario antes de crear la
 * campaña. Si alguna tarea sin terminar la usa, no se borra: la tarea fallaría
 * al llegar al paso de adjuntarla.
 */
export const DELETE = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    await dbConnect();

    const enUso = await TaskModel.exists({
      "steps.imageId": id,
      status: { $in: ["pending", "queued", "running", "paused"] },
    });
    if (enUso) {
      return NextResponse.json({ error: "La imagen la usa una tarea que todavía no terminó" }, { status: 409 });
    }

    const deleted = await GroupPostImageModel.findOneAndDelete({ _id: id, ...ownerFilter(user) });
    if (!deleted) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  },
);
