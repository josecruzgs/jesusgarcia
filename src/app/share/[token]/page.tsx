import type { Metadata } from "next";
import { dbConnect } from "@/lib/mongodb";
import DashboardModel from "@/lib/models/Dashboard";
import { getCampaignSummariesByIds } from "@/lib/campaigns";
import PublicDashboardView, { type PublicCampaign } from "./PublicDashboardView";

// Se conecta a Mongo en cada request; evitamos que Next intente
// pre-renderizar esta página en build time (no hay Mongo disponible ahí).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  await dbConnect();
  const dashboard = await DashboardModel.findOne({ token }).select("name").lean();
  return { title: dashboard ? `${dashboard.name} — Jesús García` : "Dashboard no encontrado" };
}

async function getDashboard(token: string) {
  await dbConnect();
  const dashboard = await DashboardModel.findOne({ token }).lean();
  if (!dashboard) return null;

  const campaigns = await getCampaignSummariesByIds(dashboard.campaignIds ?? [], dashboard.ownerId);
  return {
    name: dashboard.name,
    updatedAt: (dashboard.updatedAt as Date).toISOString(),
    campaigns: JSON.parse(JSON.stringify(campaigns)) as PublicCampaign[],
  };
}

export default async function PublicSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getDashboard(token);

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-page px-6 text-center">
        <p className="text-lg font-semibold text-ink">Enlace no encontrado</p>
        <p className="text-sm text-ink-secondary">Este dashboard fue eliminado o el enlace es incorrecto.</p>
      </div>
    );
  }

  return <PublicDashboardView token={token} name={data.name} updatedAt={data.updatedAt} campaigns={data.campaigns} />;
}
