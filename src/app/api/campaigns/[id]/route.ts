import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import CampaignModel from "@/lib/models/Campaign";
import TaskModel from "@/lib/models/Task";
// Registra el schema de "Profile" para que TaskModel.populate("profileId")
// no truene con "Schema hasn't been registered" en un lambda frío que nunca
// cargó /api/profiles antes.
import "@/lib/models/Profile";
import { makeCampaignSummary, type TaskStatusCounts } from "@/lib/campaigns";
import { withAuth } from "@/lib/apiHandler";

/**
 * Los tipos de campaña que trabajan sobre una publicación concreta.
 *
 * En estas, el primer paso "goto" de cada tarea es el posteo, y es el mismo
 * para todas: la campaña se arma eligiendo perfiles para una URL. Warmup y
 * publicaciones también empiezan con un "goto", pero al muro o al grupo, así
 * que llamarle "la publicación de la campaña" sería mentir.
 */
const CAMPAIGN_TYPES_WITH_POST = new Set(["like", "likecomment", "comment", "ramificacion"]);

/**
 * La publicación sobre la que trabaja la campaña, sacada de la primera tarea.
 *
 * Se mira una sola tarea y no todas por dos motivos: los `steps` son lo más
 * pesado de una tarea y traerlos de las 300 para leer un campo no se paga, y
 * en las ramificaciones las tareas hijas terminan apuntando al comentario del
 * padre —no al posteo—, así que la primera es justamente la que conserva la
 * URL original.
 */
async function findCampaignPostUrl(campaignId: string, type: string) {
  if (!CAMPAIGN_TYPES_WITH_POST.has(type)) return null;

  // `lean()` sobre una proyección devuelve los steps sin tipar; solo se leen
  // estos dos campos.
  const first = await TaskModel.findOne({ campaignId })
    .sort({ scheduledAt: 1, createdAt: 1 })
    .select("steps")
    .lean<{ steps?: { action?: string; url?: string }[] } | null>();

  return first?.steps?.find((step) => step.action === "goto" && step.url)?.url ?? null;
}

export const GET = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    // Por _id y ownerId en la misma consulta: una campaña ajena no se encuentra
    // y después se rechaza, directamente no existe para este usuario.
    const campaign = await CampaignModel.findOne({ _id: id, ownerId: user.objectId }).lean();
    if (!campaign) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const tasks = await TaskModel.find({ campaignId: id })
      .populate("profileId", "name adsPowerProfileId")
      .select("name type status profileId scheduledAt startedAt finishedAt error")
      .sort({ scheduledAt: 1, createdAt: 1 })
      .lean();

    const counts = tasks.reduce<TaskStatusCounts>((acc, task) => {
      acc[task.status] = (acc[task.status] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      campaign: makeCampaignSummary({ campaign, counts }),
      postUrl: await findCampaignPostUrl(id, campaign.type),
      tasks,
    });
  },
);

export const DELETE = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const campaign = await CampaignModel.findOne({ _id: id, ownerId: user.objectId }).select("_id").lean();
    if (!campaign) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const runningCount = await TaskModel.countDocuments({ campaignId: id, status: "running" });
    if (runningCount > 0) {
      return NextResponse.json(
        { error: "No se puede eliminar una campaña con tareas corriendo" },
        { status: 409 },
      );
    }

    const taskResult = await TaskModel.deleteMany({ campaignId: id });
    await CampaignModel.deleteOne({ _id: id });

    return NextResponse.json({
      deletedCampaignId: id,
      deletedTaskCount: taskResult.deletedCount,
    });
  },
);
