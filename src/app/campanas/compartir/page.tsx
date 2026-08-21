"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import Card from "@/components/Card";

type DashboardSummary = {
  _id: string;
  name: string;
  token: string;
  campaignCount: number;
  createdAt: string;
  updatedAt: string;
};

type DashboardDetail = DashboardSummary & { campaignIds: string[] };

type CampaignOption = {
  _id: string;
  name: string;
  type: string;
  status: string;
};

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

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function shareUrlFor(token: string) {
  // NEXT_PUBLIC_SHARE_BASE_URL manda cuando existe: si esta página corre en
  // tu máquina (localhost) pero el deploy público vive en otro dominio (ej.
  // Vercel), el link que se copia debe apuntar a ese dominio, no al local.
  const base = process.env.NEXT_PUBLIC_SHARE_BASE_URL?.replace(/\/$/, "");
  if (base) return `${base}/share/${token}`;
  if (typeof window === "undefined") return `/share/${token}`;
  return `${window.location.origin}/share/${token}`;
}

export default function ShareDashboardsPage() {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSelected, setFormSelected] = useState<Set<string>>(new Set());
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const loadDashboards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ dashboards: DashboardSummary[] }>("/api/dashboards");
      setDashboards(data.dashboards);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboards();
  }, [loadDashboards]);

  const loadCampaignOptions = useCallback(async () => {
    setCampaignsLoading(true);
    try {
      const data = await apiFetch<{ campaigns: CampaignOption[] }>("/api/campaigns?pageSize=100");
      setCampaigns(data.campaigns);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setCampaignsLoading(false);
    }
  }, []);

  function openCreateForm() {
    setEditingId(null);
    setFormName("");
    setFormSelected(new Set());
    setFormError(null);
    setCreatedLink(null);
    setCampaignSearch("");
    setFormOpen(true);
    loadCampaignOptions();
  }

  async function openEditForm(dashboard: DashboardSummary) {
    setEditingId(dashboard._id);
    setFormName(dashboard.name);
    setFormSelected(new Set());
    setFormError(null);
    setCreatedLink(null);
    setCampaignSearch("");
    setFormOpen(true);
    loadCampaignOptions();
    try {
      const detail = await apiFetch<DashboardDetail>(`/api/dashboards/${dashboard._id}`);
      setFormSelected(new Set(detail.campaignIds));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setCreatedLink(null);
  }

  function toggleCampaign(id: string) {
    setFormSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveForm() {
    const name = formName.trim();
    if (!name) {
      setFormError("Ponle un nombre al dashboard");
      return;
    }
    setFormSaving(true);
    setFormError(null);
    try {
      const campaignIds = Array.from(formSelected);
      if (editingId) {
        await apiFetch(`/api/dashboards/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({ name, campaignIds }),
        });
        await loadDashboards();
        closeForm();
      } else {
        const created = await apiFetch<DashboardSummary>("/api/dashboards", {
          method: "POST",
          body: JSON.stringify({ name, campaignIds }),
        });
        await loadDashboards();
        setEditingId(created._id);
        setCreatedLink(shareUrlFor(created.token));
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setFormSaving(false);
    }
  }

  async function deleteDashboard(dashboard: DashboardSummary) {
    const ok = confirm(`¿Eliminar el dashboard "${dashboard.name}"? El enlace dejará de funcionar.`);
    if (!ok) return;
    setDeletingId(dashboard._id);
    setError(null);
    try {
      await apiFetch(`/api/dashboards/${dashboard._id}`, { method: "DELETE" });
      setDashboards((prev) => prev.filter((d) => d._id !== dashboard._id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrlFor(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((current) => (current === token ? null : current)), 2000);
    } catch {
      // Clipboard puede fallar por permisos del navegador; el enlace sigue
      // visible en el input de texto para copiarlo a mano.
    }
  }

  const filteredCampaignOptions = useMemo(() => {
    const query = campaignSearch.trim().toLowerCase();
    if (!query) return campaigns;
    return campaigns.filter((c) => c.name.toLowerCase().includes(query));
  }, [campaigns, campaignSearch]);

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/campanas"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
              title="Volver a campañas"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-2xl font-semibold text-ink">Dashboards compartidos</h1>
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            Crea enlaces públicos con las campañas que quieras mostrar a tus clientes.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
        >
          <Plus className="h-4 w-4" /> Nuevo dashboard
        </button>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Campañas</th>
                <th className="px-4 py-3 font-medium">Enlace</th>
                <th className="px-4 py-3 font-medium">Actualizado</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && dashboards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    Cargando...
                  </td>
                </tr>
              ) : dashboards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    Todavía no creaste ningún dashboard para compartir.
                  </td>
                </tr>
              ) : (
                dashboards.map((dashboard) => (
                  <tr key={dashboard._id} className="border-t border-hairline transition-colors hover:bg-page/60">
                    <td className="px-4 py-3 font-medium text-ink">{dashboard.name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{dashboard.campaignCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-72 items-center gap-2">
                        <input
                          readOnly
                          value={shareUrlFor(dashboard.token)}
                          onFocus={(e) => e.currentTarget.select()}
                          className="w-full truncate rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs text-ink-secondary outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => copyLink(dashboard.token)}
                          title="Copiar enlace"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                        >
                          {copiedToken === dashboard.token ? (
                            <Check className="h-4 w-4 text-success" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                        <a
                          href={`/share/${dashboard.token}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir vista pública"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(dashboard.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditForm(dashboard)}
                          title="Editar campañas"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === dashboard._id}
                          onClick={() => deleteDashboard(dashboard)}
                          title="Eliminar dashboard"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:border-critical/40 hover:bg-critical/10 hover:text-critical disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {formOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <Card className="flex h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden sm:h-auto sm:max-h-[calc(100dvh-3rem)]">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <span className="accent-fill flex h-9 w-9 items-center justify-center rounded-lg">
                  <Share2 className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-semibold tracking-tight text-ink">
                  {editingId ? "Editar dashboard" : "Nuevo dashboard"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeForm}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="flex flex-col gap-4">
                {formError && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{formError}</p>}

                {createdLink && (
                  <div className="flex flex-col gap-2 rounded-xl border border-success/40 bg-success/10 p-3">
                    <p className="text-sm font-medium text-success">Dashboard creado. Comparte este enlace:</p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={createdLink}
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full truncate rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs text-ink"
                      />
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(createdLink)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-page hover:text-ink"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">Nombre</label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Ej. Reporte cliente XYZ"
                    className="mt-1 w-full rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                      Campañas a mostrar ({formSelected.size})
                    </label>
                  </div>
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                    <input
                      value={campaignSearch}
                      onChange={(e) => setCampaignSearch(e.target.value)}
                      placeholder="Buscar campaña..."
                      className="w-full rounded-lg border border-hairline bg-page py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
                    />
                  </div>
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-hairline">
                    {campaignsLoading ? (
                      <p className="p-4 text-center text-sm text-ink-muted">Cargando campañas...</p>
                    ) : filteredCampaignOptions.length === 0 ? (
                      <p className="p-4 text-center text-sm text-ink-muted">Sin campañas.</p>
                    ) : (
                      filteredCampaignOptions.map((campaign) => (
                        <label
                          key={campaign._id}
                          className="flex cursor-pointer items-center gap-3 border-b border-hairline px-3 py-2 last:border-b-0 hover:bg-page"
                        >
                          <input
                            type="checkbox"
                            checked={formSelected.has(campaign._id)}
                            onChange={() => toggleCampaign(campaign._id)}
                            className="h-4 w-4 accent-primary"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{campaign.name}</span>
                          <span className="shrink-0 text-xs text-ink-muted">
                            {TYPE_LABELS[campaign.type] ?? campaign.type}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline p-4 sm:p-5">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
              >
                {createdLink ? "Cerrar" : "Cancelar"}
              </button>
              <button
                type="button"
                disabled={formSaving}
                onClick={saveForm}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors disabled:pointer-events-none disabled:opacity-60"
              >
                {formSaving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear y generar enlace"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
