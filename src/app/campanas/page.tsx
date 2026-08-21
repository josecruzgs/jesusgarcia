"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import {
  Activity,
  Eye,
  Heart,
  Megaphone,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import Card from "@/components/Card";
import ElementIcon from "@/components/ui/ElementIcon";
import Pagination from "@/components/Pagination";
import StatusBadge from "@/components/StatusBadge";

type Counts = {
  pending: number;
  queued: number;
  running: number;
  paused: number;
  success: number;
  failed: number;
  cancelled: number;
};

type Campaign = {
  _id: string;
  name: string;
  type: string;
  status: string;
  taskCount: number;
  counts: Counts;
  createdAt: string;
  updatedAt: string;
};

type CampaignTask = {
  _id: string;
  name: string;
  type: string;
  status: string;
  profileId: { _id: string; name: string; adsPowerProfileId?: string } | null;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

type CampaignDetail = {
  campaign: Campaign;
  tasks: CampaignTask[];
};

const PAGE_SIZE = 20;
const STATUSES = ["pending", "queued", "running", "paused", "success", "failed", "partial", "cancelled", "empty"];
const TYPES = ["like", "likecomment", "comment", "post", "warmup", "scrape", "custom"];

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

// Solo los tipos con un formulario que soporta "agregar a campaña
// existente" (ver ExistingCampaignPicker) tienen a dónde mandar el botón.
const TYPE_ROUTES: Record<string, string> = {
  like: "/tasks/like",
  likecomment: "/tasks/likecomment",
  comment: "/tasks/comment",
  post: "/tasks/post",
  warmup: "/tasks/warmup",
};

export default function CampaignsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse-soft rounded-2xl bg-surface" />}>
      <CampaignsContent />
    </Suspense>
  );
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function progressFor(campaign: Campaign) {
  const done = campaign.counts.success + campaign.counts.failed + campaign.counts.cancelled;
  if (!campaign.taskCount) return 0;
  return Math.round((done / campaign.taskCount) * 100);
}

function CampaignsContent() {
  const searchParams = useSearchParams();
  const campaignIdParam = searchParams.get("campaignId");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [runningPending, setRunningPending] = useState(false);
  const [pausingCampaign, setPausingCampaign] = useState(false);
  const [resumingCampaign, setResumingCampaign] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      const data = await apiFetch<{ campaigns: Campaign[]; total: number }>(`/api/campaigns?${params}`);
      setCampaigns(data.campaigns);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page, search, status, type]);

  const loadCampaign = useCallback(async (id: string, silent = false) => {
    if (!silent) setDetailLoading(true);
    setError(null);
    try {
      const data = await apiFetch<CampaignDetail>(`/api/campaigns/${id}`);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, []);

  const openCampaign = useCallback(
    async (id: string) => {
      setSelectedId(id);
      await loadCampaign(id);
    },
    [loadCampaign],
  );

  const closeCampaign = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!campaignIdParam || campaignIdParam === selectedId) return;
    openCampaign(campaignIdParam);
  }, [campaignIdParam, openCampaign, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => loadCampaign(selectedId, true), 5000);
    return () => clearInterval(interval);
  }, [loadCampaign, selectedId]);

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
  }, [closeCampaign, selectedId]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedCampaign = detail?.campaign;
  const pendingInDetail = selectedCampaign?.counts.pending ?? 0;
  const pausableInDetail = (selectedCampaign?.counts.queued ?? 0) + (selectedCampaign?.counts.pending ?? 0);
  const pausedInDetail = selectedCampaign?.counts.paused ?? 0;
  const hasFilters = Boolean(search || status || type);

  const totals = useMemo(
    () =>
      campaigns.reduce(
        (acc, campaign) => {
          acc.tasks += campaign.taskCount;
          acc.running += campaign.counts.running;
          acc.queued += campaign.counts.queued;
          acc.success += campaign.counts.success;
          acc.failed += campaign.counts.failed;
          return acc;
        },
        { tasks: 0, running: 0, queued: 0, success: 0, failed: 0 },
      ),
    [campaigns],
  );

  async function runPendingTasks() {
    if (!selectedId) return;
    setRunningPending(true);
    setError(null);
    try {
      await apiFetch(`/api/campaigns/${selectedId}/run`, { method: "POST" });
      await Promise.all([load(), loadCampaign(selectedId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningPending(false);
    }
  }

  async function pauseCampaign() {
    if (!selectedId) return;
    setPausingCampaign(true);
    setError(null);
    try {
      await apiFetch(`/api/campaigns/${selectedId}/pause`, { method: "POST" });
      await Promise.all([load(), loadCampaign(selectedId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPausingCampaign(false);
    }
  }

  async function resumeCampaign() {
    if (!selectedId) return;
    setResumingCampaign(true);
    setError(null);
    try {
      await apiFetch(`/api/campaigns/${selectedId}/resume`, { method: "POST" });
      await Promise.all([load(), loadCampaign(selectedId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResumingCampaign(false);
    }
  }

  async function deleteCampaign(campaign: Campaign) {
    if (campaign.counts.running > 0) return;

    const ok = confirm(
      `¿Eliminar la campaña "${campaign.name}"? También se eliminarán sus ${campaign.taskCount} tareas.`,
    );
    if (!ok) return;

    setDeletingId(campaign._id);
    setError(null);
    try {
      await apiFetch<{ deletedCampaignId: string; deletedTaskCount: number }>(`/api/campaigns/${campaign._id}`, {
        method: "DELETE",
      });

      if (selectedId === campaign._id) closeCampaign();
      setCampaigns((prev) => prev.filter((item) => item._id !== campaign._id));
      setTotal((prev) => Math.max(0, prev - 1));

      if (campaigns.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setStatus("");
    setType("");
    setPage(1);
  }

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] accent-fill border">
            <ElementIcon name="agua" size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink">Campañas</h1>
            <p className="label-mono-sm mt-1">{total} campañas · tareas agrupadas por perfil</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/campanas/compartir"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <Share2 className="h-4 w-4" /> Compartir
          </Link>
          <Link
            href="/tasks/like"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <Heart className="h-4 w-4" /> Likes
          </Link>
          <Link
            href="/tasks/comment"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <MessageSquare className="h-4 w-4" /> Comentarios
          </Link>
          <Link
            href="/tasks/post"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <Megaphone className="h-4 w-4" /> Publicaciones
          </Link>
          <Link
            href="/tasks/warmup"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <Activity className="h-4 w-4" /> Warmup
          </Link>
        </div>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4">
          <p className="label-mono">Tareas</p>
          <p className="stat-value mt-2.5">{totals.tasks}</p>
        </Card>
        <Card className="p-4">
          <p className="label-mono">Corriendo</p>
          <p className="stat-value mt-2.5 text-warning">{totals.running}</p>
        </Card>
        <Card className="p-4">
          <p className="label-mono">En cola</p>
          <p className="stat-value mt-2.5 text-primary">{totals.queued}</p>
        </Card>
        <Card className="p-4">
          <p className="label-mono">Exitosas</p>
          <p className="stat-value mt-2.5 text-success">{totals.success}</p>
        </Card>
        <Card className="p-4">
          <p className="label-mono">Fallidas</p>
          <p className="stat-value mt-2.5 text-critical">{totals.failed}</p>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-50 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar campaña..."
            className="w-full rounded-lg border border-hairline bg-page py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los tipos</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={load}
          title="Actualizar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs text-ink-muted underline hover:text-ink">
            Limpiar filtros
          </button>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Campaña</th>
                <th className="px-4 py-3 font-medium">Avance</th>
                <th className="px-4 py-3 font-medium">Tareas</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Creada</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                    Cargando...
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                    Sin campañas todavía.
                  </td>
                </tr>
              ) : (
                campaigns.map((campaign) => {
                  const progress = progressFor(campaign);
                  return (
                    <tr key={campaign._id} className="border-t border-hairline transition-colors hover:bg-page/60">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openCampaign(campaign._id)}
                          className="max-w-80 text-left font-medium text-ink hover:text-primary hover:underline"
                        >
                          <span className="block truncate">{campaign.name}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex min-w-36 items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-page">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="w-9 text-right text-xs text-ink-muted">{progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {campaign.taskCount}
                        <span className="ml-2 text-xs text-ink-muted">
                          {campaign.counts.success} ok / {campaign.counts.failed} fail
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{TYPE_LABELS[campaign.type] ?? campaign.type}</td>
                      <td className="px-4 py-3 text-ink-secondary">{formatDate(campaign.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openCampaign(campaign._id)}
                            title="Ver perfiles y tareas"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === campaign._id || campaign.counts.running > 0}
                            onClick={() => deleteCampaign(campaign)}
                            title={
                              campaign.counts.running > 0
                                ? "No se puede eliminar mientras hay tareas corriendo"
                                : "Eliminar campaña"
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:border-critical/40 hover:bg-critical/10 hover:text-critical disabled:pointer-events-none disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-hairline px-2">
          <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </div>
      </Card>

      {mounted &&
        selectedId &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeCampaign();
            }}
          >
            <Card className="flex h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden sm:h-[calc(100dvh-3rem)]">
            <div className="shrink-0 border-b border-hairline p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold tracking-tight text-ink">
                    {selectedCampaign?.name ?? "Campaña"}
                  </h2>
                  {selectedCampaign && <StatusBadge status={selectedCampaign.status} />}
                </div>
                {selectedCampaign && (
                  <p className="mt-1 text-sm text-ink-secondary">
                    {TYPE_LABELS[selectedCampaign.type] ?? selectedCampaign.type} · {selectedCampaign.taskCount} perfiles
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedCampaign && TYPE_ROUTES[selectedCampaign.type] && (
                  <Link
                    href={`${TYPE_ROUTES[selectedCampaign.type]}?campaignId=${selectedCampaign._id}`}
                    title="Elegir más perfiles y sumarlos a esta campaña"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-page px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
                  >
                    <Plus className="h-4 w-4" /> Agregar tareas
                  </Link>
                )}
                <button
                  type="button"
                  disabled={!pendingInDetail || runningPending}
                  onClick={runPendingTasks}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-page px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                >
                  <Play className="h-4 w-4" /> {runningPending ? "Encolando..." : "Ejecutar pendientes"}
                </button>
                {pausedInDetail > 0 ? (
                  <button
                    type="button"
                    disabled={resumingCampaign}
                    onClick={resumeCampaign}
                    title="Reanudar las tareas pausadas de esta campaña"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-medium text-success transition-colors hover:bg-success/20 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Play className="h-4 w-4" /> {resumingCampaign ? "Reanudando..." : "Reanudar"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!pausableInDetail || pausingCampaign}
                    onClick={pauseCampaign}
                    title="Pausar tareas pendientes/en cola para corregir algo antes de seguir"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-page px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Pause className="h-4 w-4" /> {pausingCampaign ? "Pausando..." : "Pausar"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => loadCampaign(selectedId)}
                  title="Actualizar detalle"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={closeCampaign}
                  title="Cerrar"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {detailLoading && !detail ? (
                <div className="h-48 animate-pulse-soft rounded-xl bg-page" />
              ) : detail ? (
                <div className="flex flex-col gap-4">
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {Object.entries(detail.campaign.counts).map(([key, value]) => (
                      <div key={key} className="rounded-xl border border-hairline bg-page p-3">
                        <p className="label-mono">{key}</p>
                        <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-hairline">
                    <table className="w-full text-sm">
                      <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
                        <tr>
                          <th className="px-4 py-3 font-medium">Perfil</th>
                          <th className="px-4 py-3 font-medium">Tarea</th>
                          <th className="px-4 py-3 font-medium">Estado</th>
                          <th className="px-4 py-3 font-medium">Programada</th>
                          <th className="px-4 py-3 font-medium">Terminó</th>
                          <th className="px-4 py-3 font-medium">Error</th>
                          <th className="px-4 py-3 font-medium">Abrir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.tasks.map((task) => (
                          <tr key={task._id} className="border-t border-hairline">
                            <td className="px-4 py-3">
                              <p className="font-medium text-ink">{task.profileId?.name ?? "Sin perfil"}</p>
                              {task.profileId?.adsPowerProfileId && (
                                <p className="text-xs text-ink-muted">{task.profileId.adsPowerProfileId}</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-ink-secondary">{task.name}</td>
                            <td className="px-4 py-3">
                              <StatusBadge status={task.status} />
                            </td>
                            <td className="px-4 py-3 text-ink-secondary">{formatDate(task.scheduledAt)}</td>
                            <td className="px-4 py-3 text-ink-secondary">{formatDate(task.finishedAt)}</td>
                            <td className="max-w-72 px-4 py-3 text-xs text-critical">
                              {task.error ? <span className="line-clamp-3">{task.error}</span> : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                href={`/tasks/${task._id}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                                title="Abrir tarea"
                              >
                                <Eye className="h-4 w-4" />
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
