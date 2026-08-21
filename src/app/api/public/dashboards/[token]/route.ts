import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import DashboardModel from "@/lib/models/Dashboard";
import { getCampaignSummariesByIds } from "@/lib/campaigns";
import { withApiErrors } from "@/lib/apiHandler";

export const GET = withApiErrors(
  async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
    const { token } = await params;
    await dbConnect();

    const dashboard = await DashboardModel.findOne({ token }).lean();
    if (!dashboard) return NextResponse.json({ error: "Enlace no encontrado" }, { status: 404 });

    // Acá la credencial es el token del enlace, no una sesión. El alcance sale
    // del dueño del dashboard: se muestran sus campañas y solo las suyas.
    const campaigns = await getCampaignSummariesByIds(dashboard.campaignIds ?? [], dashboard.ownerId);

    return NextResponse.json({
      name: dashboard.name,
      updatedAt: dashboard.updatedAt,
      campaigns,
    });
  },
);
