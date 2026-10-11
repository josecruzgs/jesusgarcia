import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import CampaignModel from "@/lib/models/Campaign";
import TaskModel from "@/lib/models/Task";
import { makeCampaignSummary, type TaskStatusCounts } from "@/lib/campaigns";
import { withAuth } from "@/lib/apiHandler";
import { ownerNames, visibleOwnerFilter } from "@/lib/auth/dal";
import { escapeRegex } from "@/lib/regex";

type CountRow = {
  _id: { campaignId: Types.ObjectId; status: string };
  count: number;
};

export const GET = withAuth(async (user, req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const type = sp.get("type") ?? "";
  const search = sp.get("search")?.trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 20));

  await dbConnect();

  const filter: Record<string, unknown> = { ...visibleOwnerFilter(user) };
  if (type) filter.type = type;
  if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };

  const campaignDocs = await CampaignModel.find(filter).sort({ createdAt: -1 }).lean();
  const campaignIds = campaignDocs.map((campaign) => campaign._id);

  const countRows =
    campaignIds.length > 0
      ? await TaskModel.aggregate<CountRow>([
          { $match: { campaignId: { $in: campaignIds } } },
          { $group: { _id: { campaignId: "$campaignId", status: "$status" }, count: { $sum: 1 } } },
        ])
      : [];

  const countsByCampaign = new Map<string, TaskStatusCounts>();
  for (const row of countRows) {
    const key = String(row._id.campaignId);
    const counts = countsByCampaign.get(key) ?? {};
    counts[row._id.status] = row.count;
    countsByCampaign.set(key, counts);
  }

  const names = await ownerNames(user, campaignDocs.map((campaign) => campaign.ownerId));
  const summaries = campaignDocs.map((campaign) => ({
    ...makeCampaignSummary({
      campaign,
      counts: countsByCampaign.get(String(campaign._id)) ?? {},
    }),
    // Solo llega para el admin: es quien ve campañas de otros.
    ownerName: names.get(String(campaign.ownerId)),
  }));
  const filtered = status ? summaries.filter((campaign) => campaign.status === status) : summaries;
  const total = filtered.length;
  const campaigns = filtered.slice((page - 1) * pageSize, page * pageSize);

  return NextResponse.json({ campaigns, total, page, pageSize });
});
