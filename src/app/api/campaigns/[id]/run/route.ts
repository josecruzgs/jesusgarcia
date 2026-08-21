import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import CampaignModel from "@/lib/models/Campaign";
import TaskModel from "@/lib/models/Task";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const campaign = await CampaignModel.findOne({ _id: id, ownerId: user.objectId }).select("_id").lean();
    if (!campaign) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const result = await TaskModel.updateMany(
      { campaignId: id, status: "pending" },
      { $set: { status: "queued" }, $unset: { error: "" } },
    );

    return NextResponse.json({ queuedCount: result.modifiedCount });
  },
);
