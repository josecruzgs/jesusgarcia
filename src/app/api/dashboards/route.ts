import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import DashboardModel from "@/lib/models/Dashboard";
import { assertOwnedCampaigns, generateShareToken } from "@/lib/dashboards";
import { withAuth } from "@/lib/apiHandler";

export const GET = withAuth(async (user) => {
  await dbConnect();

  const dashboards = await DashboardModel.find({ ownerId: user.objectId }).sort({ createdAt: -1 }).lean();

  return NextResponse.json({
    dashboards: dashboards.map((dashboard) => ({
      _id: dashboard._id,
      name: dashboard.name,
      token: dashboard.token,
      campaignCount: dashboard.campaignIds?.length ?? 0,
      createdAt: dashboard.createdAt,
      updatedAt: dashboard.updatedAt,
    })),
  });
});

export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const campaignIds = Array.isArray(body.campaignIds)
    ? body.campaignIds.filter((id: unknown) => typeof id === "string")
    : [];

  if (!name) {
    return NextResponse.json({ error: "El nombre del dashboard es obligatorio" }, { status: 400 });
  }

  await dbConnect();
  const ownedCampaignIds = await assertOwnedCampaigns(user, campaignIds);

  // Colisión de token es prácticamente imposible (9 bytes aleatorios), pero
  // el índice unique existe por si acaso: reintentamos unas pocas veces en
  // vez de asumir que nunca va a pasar.
  let dashboard = null;
  for (let attempt = 0; attempt < 5 && !dashboard; attempt++) {
    try {
      dashboard = await DashboardModel.create({
        ownerId: user.objectId,
        name,
        campaignIds: ownedCampaignIds,
        token: generateShareToken(),
      });
    } catch (err) {
      const isDuplicateToken =
        err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000;
      if (!isDuplicateToken) throw err;
    }
  }
  if (!dashboard) {
    return NextResponse.json({ error: "No se pudo generar un token único, intenta de nuevo" }, { status: 500 });
  }

  return NextResponse.json(
    {
      _id: dashboard._id,
      name: dashboard.name,
      token: dashboard.token,
      campaignCount: dashboard.campaignIds?.length ?? 0,
      createdAt: dashboard.createdAt,
      updatedAt: dashboard.updatedAt,
    },
    { status: 201 },
  );
});
