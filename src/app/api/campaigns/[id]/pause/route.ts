import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import CampaignModel from "@/lib/models/Campaign";
import TaskModel from "@/lib/models/Task";
import { withAuth } from "@/lib/apiHandler";

// Pausa una campaña: las tareas "pending"/"queued" pasan a "paused" (el
// worker solo levanta tareas "queued", así que esto alcanza para que deje
// de tocarlas). Las que ya están "running" siguen hasta terminar — no hay
// forma segura de interrumpir un browser a mitad de un step.
export const POST = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const campaign = await CampaignModel.findOne({ _id: id, ownerId: user.objectId }).select("_id").lean();
    if (!campaign) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    // Va como pipeline de agregación —no como update normal— porque
    // `resumeStatus` se copia del valor actual de `status`, y un update plano
    // no puede leer otro campo del documento.
    //
    // `updatePipeline: true` es obligatorio desde mongoose 9: antes se aceptaba
    // el array a secas, y ahora sin la opción tira "Cannot pass an array to
    // query updates" y pausar la campaña falla en silencio para el usuario.
    const result = await TaskModel.updateMany(
      { campaignId: id, status: { $in: ["pending", "queued"] } },
      [{ $set: { resumeStatus: "$status", status: "paused" } }],
      { updatePipeline: true },
    );

    return NextResponse.json({ pausedCount: result.modifiedCount });
  },
);
