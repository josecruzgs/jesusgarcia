import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import CampaignModel from "@/lib/models/Campaign";
import TaskModel from "@/lib/models/Task";
import { withAuth } from "@/lib/apiHandler";

/**
 * Desde qué estados se puede (re)lanzar en bloque.
 *
 * Deliberadamente sin `success`: relanzar una campaña entera de likes ya
 * cumplida sería dejar el doble de interacciones desde los mismos perfiles, y
 * eso no se deshace. Lo mismo con las que están corriendo o en cola, que ya
 * van en camino.
 */
const RELAUNCHABLE = new Set(["pending", "failed", "cancelled", "paused"]);

export const POST = withAuth(
  async (user, req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const campaign = await CampaignModel.findOne({ _id: id, ownerId: user.objectId }).select("_id").lean();
    if (!campaign) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    // Cuerpo opcional: "Ejecutar pendientes" no manda nada y sigue significando
    // lo de siempre. El `catch` es para eso —un POST sin body revienta el
    // .json()—, no para tragarse un JSON mal formado.
    const body = (await req.json().catch(() => ({}))) as { status?: unknown };
    const from = typeof body.status === "string" ? body.status : "pending";

    if (!RELAUNCHABLE.has(from)) {
      return NextResponse.json(
        { error: `No se puede relanzar desde el estado "${from}"` },
        { status: 400 },
      );
    }

    const result = await TaskModel.updateMany(
      { campaignId: id, status: from },
      // Se limpia el error viejo: si vuelve a fallar querés ver por qué falló
      // ESTA vez, y si sale bien no puede quedar un error de la corrida
      // anterior colgado en la fila.
      { $set: { status: "queued" }, $unset: { error: "" } },
    );

    return NextResponse.json({ queuedCount: result.modifiedCount });
  },
);
