"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  RefreshCw,
  ListChecks,
  RefreshCcw,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  X,
  Heart,
  MessageCircleHeart,
  MessageSquare,
  Megaphone,
  Activity,
  Tornado,
  UserCog,
  LogIn,
  type LucideIcon,
} from "lucide-react";
import Card from "@/components/Card";
import StatusBadge from "@/components/StatusBadge";

export type PublicCampaign = {
  _id: string;
  name: string;
  type: string;
  taskCount: number;
  status: string;
  counts: {
    pending: number;
    queued: number;
    running: number;
    paused: number;
    success: number;
    failed: number;
    cancelled: number;
  };
  createdAt: string;
  updatedAt: string;
};

type CampaignTask = {
  _id: string;
  name: string;
  status: string;
  scheduledAt: string;
  finishedAt?: string;
  profile: { name: string } | null;
};

type CampaignDetail = { campaign: PublicCampaign; tasks: CampaignTask[] };

const TYPE_LABELS: Record<string, string> = {
  like: "Likes",
  likecomment: "Likes a comentarios",
  comment: "Comentarios",
  post: "Publicaciones",
  warmup: "Warmup",
  scrape: "Scrapping",
  custom: "Auto Profile",
  login: "Login",
};

const TYPE_ICONS: Record<string, LucideIcon> = {
  like: Heart,
  likecomment: MessageCircleHeart,
  comment: MessageSquare,
  post: Megaphone,
  warmup: Activity,
  scrape: Tornado,
  custom: UserCog,
  login: LogIn,
};

const TYPE_ICON_BG: Record<string, string> = {
  like: "bg-series-3",
  likecomment: "bg-series-3",
  comment: "bg-series-5",
  post: "bg-series-7",
  warmup: "bg-series-4",
  scrape: "bg-series-1",
  custom: "bg-primary",
  login: "bg-primary",
};

const REFRESH_MS = 20000;

function progressFor(campaign: PublicCampaign) {
  const done = campaign.counts.success + campaign.counts.failed + campaign.counts.cancelled;
  if (!campaign.taskCount) return 0;
  return Math.round((done / campaign.taskCount) * 100);
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function PublicDashboardView({
  token,
  name,
  updatedAt,
  campaigns: initialCampaigns,
}: {
  token: string;
  name: string;
  updatedAt: string;
  campaigns: PublicCampaign[];
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [lastUpdated, setLastUpdated] = useState(updatedAt);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/public/dashboards/${token}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCampaigns(data.campaigns);
      setLastUpdated(new Date().toISOString());
    } catch {
      // La vista pública no muestra errores de red: simplemente se mantiene
      // en el último estado conocido hasta el próximo refresco automático.
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const openCampaign = useCallback(
    async (campaignId: string) => {
      setSelectedId(campaignId);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/public/dashboards/${token}/campaigns/${campaignId}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "No se pudo cargar la campaña");
        setDetail(data);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : String(e));
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  function closeCampaign() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }

  useEffect(() => {
    if (!selectedId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeCampaign();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedId]);

  const totals = campaigns.reduce(
    (acc, campaign) => {
      acc.tasks += campaign.taskCount;
      acc.running += campaign.counts.running;
      acc.queued += campaign.counts.queued;
      acc.success += campaign.counts.success;
      acc.failed += campaign.counts.failed;
      return acc;
    },
    { tasks: 0, running: 0, queued: 0, success: 0, failed: 0 },
  );

  const selectedCampaign = detail?.campaign;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image src="/media/logoblack.png" alt="Jesús García" width={36} height={36} className="object-contain dark:hidden" />
          <Image src="/media/logo.png" alt="Jesús García" width={36} height={36} className="hidden object-contain dark:block" />
          <div>
            <h1 className="text-2xl font-semibold text-ink">{name}</h1>
            <p className="label-mono-sm mt-1 normal-case tracking-normal">
              {campaigns.length} campaña{campaigns.length === 1 ? "" : "s"} · actualizado{" "}
              {/* formatDate depende del locale/zona horaria del runtime — el
                  servidor y el navegador casi nunca coinciden, así que se
                  renderiza en blanco hasta después de montar en cliente para
                  no desincronizar la hidratación (ver "mounted" más abajo). */}
              {mounted ? formatDate(lastUpdated) : "…"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-colors hover:text-ink disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="p-4">
          <p className="label-mono flex items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5" /> Tareas
          </p>
          <p className="stat-value mt-2.5">{totals.tasks}</p>
        </Card>
        <Card className="p-4">
          <p className="label-mono flex items-center gap-1.5">
            <RefreshCcw className="h-3.5 w-3.5" /> Corriendo
          </p>
          <p className="stat-value mt-2.5 text-warning">{totals.running}</p>
        </Card>
        <Card className="p-4">
          <p className="label-mono flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> En cola
          </p>
          <p className="stat-value mt-2.5 text-primary">{totals.queued}</p>
        </Card>
        <Card className="p-4">
          <p className="label-mono flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> Exitosas
          </p>
          <p className="stat-value mt-2.5 text-success">{totals.success}</p>
        </Card>
        <Card className="p-4">
          <p className="label-mono flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5" /> Fallidas
          </p>
          <p className="stat-value mt-2.5 text-critical">{totals.failed}</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {campaigns.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-muted">Este dashboard todavía no tiene campañas.</p>
        ) : (
          <div className="flex flex-col divide-y divide-hairline">
            {campaigns.map((campaign) => {
              const Icon = TYPE_ICONS[campaign.type] ?? UserCog;
              const iconBg = TYPE_ICON_BG[campaign.type] ?? "bg-primary";
              const progress = progressFor(campaign);
              return (
                <button
                  key={campaign._id}
                  type="button"
                  onClick={() => openCampaign(campaign._id)}
                  className="flex flex-col gap-3 p-4 text-left transition-colors hover:bg-page/60 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg} text-white`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{campaign.name}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {TYPE_LABELS[campaign.type] ?? campaign.type} · {campaign.taskCount} tareas
                    </p>
                  </div>
                  <div className="hidden w-32 items-center gap-2 sm:flex">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-page">
                      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="w-9 text-right text-xs text-ink-muted">{progress}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pl-14 sm:contents sm:pl-0">
                    <StatusBadge status={campaign.status} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <p className="mt-auto pt-6 text-center text-xs text-ink-muted">Panel público generado con Sistema</p>

      {mounted &&
        selectedId &&
        createPortal(
          <div
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeCampaign();
            }}
          >
            <Card className="flex h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden sm:h-[calc(100dvh-3rem)]">
              <div className="shrink-0 border-b border-hairline p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {selectedCampaign &&
                      (() => {
                        const Icon = TYPE_ICONS[selectedCampaign.type] ?? UserCog;
                        const iconBg = TYPE_ICON_BG[selectedCampaign.type] ?? "bg-primary";
                        return (
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg} text-white`}>
                            <Icon className="h-5 w-5" />
                          </span>
                        );
                      })()}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-semibold tracking-tight text-ink">
                          {selectedCampaign?.name ?? "Campaña"}
                        </h2>
                        {selectedCampaign && <StatusBadge status={selectedCampaign.status} />}
                      </div>
                      {selectedCampaign && (
                        <p className="mt-1 text-sm text-ink-secondary">
                          {TYPE_LABELS[selectedCampaign.type] ?? selectedCampaign.type} · {selectedCampaign.taskCount} tareas
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeCampaign}
                    title="Cerrar"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                {detailLoading ? (
                  <div className="h-48 animate-pulse-soft rounded-lg bg-page" />
                ) : detailError ? (
                  <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">{detailError}</p>
                ) : detail ? (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      {Object.entries(detail.campaign.counts).map(([key, value]) => (
                        <div key={key} className="rounded-lg border border-hairline bg-page p-3">
                          <p className="text-xs uppercase tracking-wide text-ink-muted">{key}</p>
                          <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border border-hairline">
                      <div className="flex flex-col divide-y divide-hairline sm:hidden">
                        {detail.tasks.map((task) => (
                          <div key={task._id} className="flex flex-col gap-2 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="min-w-0 truncate font-medium text-ink">{task.profile?.name ?? "Sin perfil"}</p>
                              <StatusBadge status={task.status} />
                            </div>
                            <div className="flex flex-col gap-0.5 text-xs text-ink-secondary">
                              <span>Programada: {formatDate(task.scheduledAt)}</span>
                              <span>Terminó: {formatDate(task.finishedAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="hidden overflow-x-auto sm:block">
                        <table className="w-full text-sm">
                          <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
                            <tr>
                              <th className="px-4 py-3 font-medium">Perfil</th>
                              <th className="px-4 py-3 font-medium">Estado</th>
                              <th className="px-4 py-3 font-medium">Programada</th>
                              <th className="px-4 py-3 font-medium">Terminó</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.tasks.map((task) => (
                              <tr key={task._id} className="border-t border-hairline">
                                <td className="px-4 py-3 font-medium text-ink">{task.profile?.name ?? "Sin perfil"}</td>
                                <td className="px-4 py-3">
                                  <StatusBadge status={task.status} />
                                </td>
                                <td className="px-4 py-3 text-ink-secondary">{formatDate(task.scheduledAt)}</td>
                                <td className="px-4 py-3 text-ink-secondary">{formatDate(task.finishedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm text-ink-muted">No se pudo cargar la campaña.</p>
                )}
              </div>
            </Card>
          </div>,
          document.body,
        )}
    </div>
  );
}
