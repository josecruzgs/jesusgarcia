import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
import TaskLogModel from "@/lib/models/TaskLog";
import { withAuth } from "@/lib/apiHandler";
import { isAdmin } from "@/lib/auth/dal";
import { esRelanzamientoDeLike } from "@/lib/tasks/relanzar";
import { filtroDeTareas, type FiltrosDeTareas } from "@/lib/tasks/filtroDeTareas";

const ACCIONES = ["run", "cancel", "delete"] as const;
type Accion = (typeof ACCIONES)[number];

const MAX_IDS = 5000;

/**
 * Acciones masivas de la tabla de /tasks: relanzar, cancelar o eliminar.
 *
 * Recibe o una lista de ids (las casillas marcadas) o los filtros de la tabla
 * ("todas las que coinciden"), nunca los dos. En ambos casos el alcance pasa
 * por `filtroDeTareas`, así que un operador no puede tocar tareas ajenas
 * mandando ids a mano.
 *
 * Las reglas son las mismas que las de los botones de cada fila, y lo que no
 * las cumple se salta en vez de hacer fallar todo el lote:
 * - Relanzar no toca lo que ya está en cola o corriendo, y un like exitoso solo
 *   lo relanza un admin (cada relanzamiento es otra acción del perfil).
 * - Eliminar no toca lo que está corriendo: el worker la tiene tomada y al
 *   terminar intentaría guardar una tarea que ya no existe.
 * - Cancelar solo aplica a lo que todavía no arrancó (pendiente, en cola o
 *   pausada).
 */
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    ids?: unknown;
    filters?: FiltrosDeTareas;
  } | null;

  const action = body?.action as Accion | undefined;
  if (!action || !ACCIONES.includes(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const porIds = Array.isArray(body?.ids);
  if (porIds === Boolean(body?.filters)) {
    return NextResponse.json({ error: "Mandá `ids` o `filters`, uno de los dos" }, { status: 400 });
  }

  let alcance: Record<string, unknown>;
  if (porIds) {
    const ids = (body!.ids as unknown[]).filter(
      (id): id is string => typeof id === "string" && Types.ObjectId.isValid(id),
    );
    if (!ids.length) return NextResponse.json({ error: "No hay tareas seleccionadas" }, { status: 400 });
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ error: `Máximo ${MAX_IDS} tareas por acción` }, { status: 400 });
    }
    alcance = { ...filtroDeTareas(user, {}), _id: { $in: ids.map((id) => new Types.ObjectId(id)) } };
  } else {
    alcance = filtroDeTareas(user, body!.filters ?? {});
  }

  await dbConnect();

  const candidatas = await TaskModel.find(alcance).select("_id type status").lean();
  const admin = isAdmin(user);

  const aplica = (t: { type?: string | null; status?: string | null }) => {
    switch (action) {
      case "run":
        if (t.status === "running" || t.status === "queued") return false;
        return admin || !esRelanzamientoDeLike(t);
      case "cancel":
        return t.status === "pending" || t.status === "queued" || t.status === "paused";
      case "delete":
        return t.status !== "running";
    }
  };

  const elegidas = candidatas.filter(aplica);
  const ids = elegidas.map((t) => t._id);
  // El estado va en la condición otra vez: entre el find y la escritura el
  // worker pudo haber tomado alguna, y esa ya no se toca.
  let afectadas = 0;

  if (ids.length && action === "run") {
    const r = await TaskModel.updateMany(
      { _id: { $in: ids }, status: { $nin: ["running", "queued"] } },
      { $set: { status: "queued" }, $unset: { error: "" } },
    );
    afectadas = r.modifiedCount;
    const likes = elegidas.filter(esRelanzamientoDeLike);
    if (likes.length) {
      await TaskLogModel.insertMany(
        likes.map((t) => ({
          taskId: t._id,
          level: "info",
          message: `Relanzada por ${user.username} (acción masiva) para revisar un posible falso positivo.`,
        })),
      );
    }
  }

  if (ids.length && action === "cancel") {
    const r = await TaskModel.updateMany(
      { _id: { $in: ids }, status: { $in: ["pending", "queued", "paused"] } },
      {
        $set: { status: "cancelled", error: `Cancelada a mano por ${user.username}.`, finishedAt: new Date() },
        $unset: { resumeStatus: "" },
      },
    );
    afectadas = r.modifiedCount;
  }

  if (ids.length && action === "delete") {
    const borrables = await TaskModel.find({ _id: { $in: ids }, status: { $ne: "running" } }).select("_id").lean();
    const borrar = borrables.map((t) => t._id);
    const r = await TaskModel.deleteMany({ _id: { $in: borrar } });
    await TaskLogModel.deleteMany({ taskId: { $in: borrar } });
    afectadas = r.deletedCount ?? 0;
  }

  return NextResponse.json({ afectadas, saltadas: candidatas.length - afectadas });
});
