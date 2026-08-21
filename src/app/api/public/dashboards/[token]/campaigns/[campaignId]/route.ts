import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import DashboardModel from "@/lib/models/Dashboard";
import CampaignModel from "@/lib/models/Campaign";
import TaskModel from "@/lib/models/Task";
// Import registra el schema de "Profile" en mongoose — TaskModel.populate
// necesita eso, aunque este archivo nunca use ProfileModel directo. Sin
// esto, en un lambda frío de Vercel que nunca cargó /api/profiles antes,
// populate("profileId") revienta con "Schema hasn't been registered".
import "@/lib/models/Profile";
import { makeCampaignSummary, type TaskStatusCounts } from "@/lib/campaigns";
import { withApiErrors } from "@/lib/apiHandler";

// Detalle público de UNA campaña dentro de un dashboard compartido: solo
// responde si campaignId está en la lista que el dueño eligió mostrar para
// ese token — así un visitante no puede adivinar otros ids de campaña y
// leer datos que no le compartieron.
export const GET = withApiErrors(
  async (_req: NextRequest, { params }: { params: Promise<{ token: string; campaignId: string }> }) => {
    const { token, campaignId } = await params;
    await dbConnect();

    const dashboard = await DashboardModel.findOne({ token }).select("campaignIds").lean();
    if (!dashboard) return NextResponse.json({ error: "Enlace no encontrado" }, { status: 404 });

    const allowed = (dashboard.campaignIds ?? []).some((id: unknown) => String(id) === campaignId);
    if (!allowed) return NextResponse.json({ error: "Campaña no encontrada en este dashboard" }, { status: 404 });

    const campaign = await CampaignModel.findById(campaignId).lean();
    if (!campaign) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

    const tasks = await TaskModel.find({ campaignId })
      .populate("profileId", "name")
      .select("name status profileId scheduledAt finishedAt")
      .sort({ scheduledAt: 1, createdAt: 1 })
      .lean();

    const counts = tasks.reduce<TaskStatusCounts>((acc, task) => {
      acc[task.status] = (acc[task.status] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      campaign: makeCampaignSummary({ campaign, counts }),
      tasks: tasks.map((t) => ({
        _id: t._id,
        name: t.name,
        status: t.status,
        scheduledAt: t.scheduledAt,
        finishedAt: t.finishedAt,
        profile: t.profileId && typeof t.profileId === "object" ? { name: (t.profileId as { name: string }).name } : null,
      })),
    });
  },
);
