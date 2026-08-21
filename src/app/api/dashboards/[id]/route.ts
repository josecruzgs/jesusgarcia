import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import DashboardModel from "@/lib/models/Dashboard";
import { assertOwnedCampaigns } from "@/lib/dashboards";
import { withAuth } from "@/lib/apiHandler";

export const GET = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const dashboard = await DashboardModel.findOne({ _id: id, ownerId: user.objectId }).lean();
    if (!dashboard) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    return NextResponse.json({
      _id: dashboard._id,
      name: dashboard.name,
      token: dashboard.token,
      campaignIds: (dashboard.campaignIds ?? []).map(String),
      createdAt: dashboard.createdAt,
      updatedAt: dashboard.updatedAt,
    });
  },
);

export const PATCH = withAuth(
  async (user, req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await req.json();

    const update: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: "El nombre del dashboard es obligatorio" }, { status: 400 });
      update.name = name;
    }

    await dbConnect();

    if (Array.isArray(body.campaignIds)) {
      // El dashboard es público: una campaña ajena metida acá quedaría
      // expuesta en internet sin contraseña.
      update.campaignIds = await assertOwnedCampaigns(
        user,
        body.campaignIds.filter((cid: unknown) => typeof cid === "string"),
      );
    }

    const dashboard = await DashboardModel.findOneAndUpdate(
      { _id: id, ownerId: user.objectId },
      update,
      { new: true },
    ).lean();
    if (!dashboard) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    return NextResponse.json({
      _id: dashboard._id,
      name: dashboard.name,
      token: dashboard.token,
      campaignIds: (dashboard.campaignIds ?? []).map(String),
      createdAt: dashboard.createdAt,
      updatedAt: dashboard.updatedAt,
    });
  },
);

export const DELETE = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const dashboard = await DashboardModel.findOneAndDelete({ _id: id, ownerId: user.objectId })
      .select("_id")
      .lean();
    if (!dashboard) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    return NextResponse.json({ deletedDashboardId: id });
  },
);
