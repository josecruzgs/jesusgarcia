import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
import TaskLogModel from "@/lib/models/TaskLog";
import { withAuth } from "@/lib/apiHandler";
import { isAdmin, visibleOwnerFilter } from "@/lib/auth/dal";
import { esRelanzamientoDeLike } from "@/lib/tasks/relanzar";

// Encola la tarea para que el worker (src/worker/index.ts) la recoja y
// ejecute. No corremos Playwright directamente en la request de Next.js
// porque una automatización puede tardar mucho más que el timeout de un
// API route.
export const POST = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const task = await TaskModel.findOne({ _id: id, ...visibleOwnerFilter(user) });
    if (!task) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    // Un like que salió "exitoso" puede haber sido un falso positivo (antes el
    // runner reaccionaba a un comentario o no verificaba). Relanzarlo es para
    // revisar esos casos y lo decide un admin: cada relanzamiento es otra
    // acción del perfil sobre la publicación.
    const relanzamiento = esRelanzamientoDeLike(task);
    if (relanzamiento && !isAdmin(user)) {
      return NextResponse.json({ error: "Solo un admin puede relanzar likes exitosos." }, { status: 403 });
    }

    task.status = "queued";
    task.error = undefined;
    await task.save();

    if (relanzamiento) {
      await TaskLogModel.create({
        taskId: task._id,
        level: "info",
        message: `Relanzada por ${user.username} para revisar un posible falso positivo.`,
      });
    }

    return NextResponse.json({ task });
  },
);
