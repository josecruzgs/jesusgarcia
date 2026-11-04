import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import CampaignModel from "@/lib/models/Campaign";
import TaskModel from "@/lib/models/Task";
import TaskLogModel from "@/lib/models/TaskLog";
import { withAuth } from "@/lib/apiHandler";
import { isAdmin, visibleOwnerFilter } from "@/lib/auth/dal";

/**
 * Desde qué estados se puede (re)lanzar en bloque.
 *
 * Deliberadamente sin `success`: relanzar una campaña entera de likes ya
 * cumplida sería dejar el doble de interacciones desde los mismos perfiles, y
 * eso no se deshace. Lo mismo con las que están corriendo o en cola, que ya
 * van en camino.
 *
 * La excepción es `success` en una campaña de likes, y solo para un admin:
 * sirve para corregir falsos positivos, y es seguro porque el runner detecta
 * el like ya puesto y no lo quita.
 */
const RELAUNCHABLE = new Set(["pending", "failed", "cancelled", "paused"]);

export const POST = withAuth(
  async (user, req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const campaign = await CampaignModel.findOne({ _id: id, ...visibleOwnerFilter(user) }).select("_id type").lean();
    if (!campaign) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    // Cuerpo opcional: "Ejecutar pendientes" no manda nada y sigue significando
    // lo de siempre. El `catch` es para eso —un POST sin body revienta el
    // .json()—, no para tragarse un JSON mal formado.
    const body = (await req.json().catch(() => ({}))) as { status?: unknown; excludeProfileIds?: unknown };
    const from = typeof body.status === "string" ? body.status : "pending";
    // Perfiles que no se relanzan aunque tengan tareas en ese estado: los que
    // "Relanzar fallidas" quiso eliminar por revisión de seguridad y no pudo
    // (tenían una tarea corriendo). Relanzarlos sería mandarlos a fallar de nuevo.
    const excludeProfileIds = Array.isArray(body.excludeProfileIds)
      ? body.excludeProfileIds.filter((v): v is string => typeof v === "string" && Types.ObjectId.isValid(v))
      : [];

    const relanzarExitosas = from === "success" && campaign.type === "like";
    if (relanzarExitosas && !isAdmin(user)) {
      return NextResponse.json({ error: "Solo un admin puede relanzar likes exitosos." }, { status: 403 });
    }

    if (!RELAUNCHABLE.has(from) && !relanzarExitosas) {
      return NextResponse.json(
        { error: `No se puede relanzar desde el estado "${from}"` },
        { status: 400 },
      );
    }

    const filtro = {
      campaignId: id,
      status: from,
      ...(relanzarExitosas ? { type: "like" } : {}),
      ...(excludeProfileIds.length ? { profileId: { $nin: excludeProfileIds.map((v) => new Types.ObjectId(v)) } } : {}),
    };
    // Para dejar en el log de cada tarea quién la relanzó (solo exitosas).
    const relanzadas = relanzarExitosas ? await TaskModel.find(filtro).select("_id").lean() : [];

    const result = await TaskModel.updateMany(
      filtro,
      // Se limpia el error viejo: si vuelve a fallar querés ver por qué falló
      // ESTA vez, y si sale bien no puede quedar un error de la corrida
      // anterior colgado en la fila.
      { $set: { status: "queued" }, $unset: { error: "" } },
    );

    // Si el runner la había frenado, relanzarla es decir "probá de nuevo": el
    // aviso viejo ya no aplica, y si el motivo sigue, el runner lo vuelve a poner.
    if (result.modifiedCount) await CampaignModel.updateOne({ _id: id }, { $unset: { stopReason: "" } });

    if (relanzadas.length) {
      await TaskLogModel.insertMany(
        relanzadas.map((t) => ({
          taskId: t._id,
          level: "info",
          message: `Relanzada por ${user.username} (exitosas de la campaña) para revisar un posible falso positivo.`,
        })),
      );
    }

    return NextResponse.json({ queuedCount: result.modifiedCount });
  },
);
