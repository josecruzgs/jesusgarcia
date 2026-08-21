"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Modal from "@/components/Modal";
import ElementIcon from "@/components/ui/ElementIcon";
import ProjectForm, { EMPTY_DRAFT, type ProjectDraft } from "@/components/listening/ProjectForm";

type ProviderStatus = { id: string; label: string; credentialEnv: string | null; configured: boolean };

type Project = {
  _id: string;
  name: string;
  description?: string;
  entities: { name: string; aliases: string[] }[];
  status: "active" | "paused";
  mentionCount: number;
  intervalMinutes: number;
  lastRunAt?: string;
  lastRunError?: string;
};

function relativeTime(iso?: string): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

export default function EscuchaPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_DRAFT);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ projects: Project[]; providers: ProviderStatus[] }>(
        "/api/listening/projects",
      );
      setProjects(data.projects);
      setProviders(data.providers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/listening/projects", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          entities: draft.entities.filter((e) => e.name.trim()),
        }),
      });
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const missing = providers.filter((p) => !p.configured);

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] accent-fill border">
            <ElementIcon name="viento" size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink">Escucha</h1>
            <p className="label-mono-sm mt-1">
              {projects.length} proyecto{projects.length === 1 ? "" : "s"} · monitoreo de figuras públicas
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setCreating(true);
            }}
            className="glow-btn inline-flex items-center gap-1.5 rounded-[9px] bg-primary px-3 py-2 text-sm font-semibold text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" /> Nuevo proyecto
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-[9px] border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {error}
        </p>
      )}

      {missing.length > 0 && (
        <div className="card-surface flex items-start gap-3 p-4" style={{ ["--edge-c" as string]: "var(--amber)" }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-[13px] leading-relaxed text-ink-secondary">
            <span className="font-medium text-ink">Fuentes sin configurar.</span>{" "}
            {missing.map((p) => `${p.label} necesita ${p.credentialEnv}`).join(" · ")}. Las demás
            funcionan igual; estas quedan apagadas hasta que cargues la credencial en{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">.env.local</code>.
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse-soft rounded-[14px] bg-surface-2" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="card-surface flex flex-col items-center gap-3 px-8 py-14 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl accent-fill border">
            <ElementIcon name="viento" size={26} />
          </span>
          <h2 className="font-display text-xl font-semibold text-ink">Todavía no escuchas a nadie</h2>
          <p className="max-w-md text-[13px] leading-relaxed text-ink-secondary">
            Crea un proyecto con las figuras que quieras monitorear. Google News y GDELT arrancan sin
            configurar nada; las redes sociales entran cuando conectes Bright Data.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="glow-btn mt-1 inline-flex items-center gap-1.5 rounded-[9px] bg-primary px-4 py-2 text-sm font-semibold text-primary-fg"
          >
            <Plus className="h-4 w-4" /> Crear el primero
          </button>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project._id}
              href={`/scrapping/proyecto/${project._id}`}
              className="card-surface card-lift flex flex-col gap-3 px-4.5 py-4"
              style={{ ["--edge-c" as string]: "var(--el-viento)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-[17px] font-semibold leading-tight text-ink">
                  {project.name}
                </h2>
                <span
                  className={`opchip shrink-0 ${project.status === "active" ? "" : "is-off"}`}
                  style={project.status === "paused" ? { color: "var(--text-muted)" } : undefined}
                >
                  {project.status === "active" ? <i /> : null}
                  {project.status === "active" ? "ACTIVO" : "PAUSADO"}
                </span>
              </div>

              <p className="label-mono-sm normal-case tracking-normal">
                {project.entities.map((e) => e.name).join(" · ") || "Sin figuras"}
              </p>

              <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                <div>
                  <p className="stat-value text-[22px]">{project.mentionCount ?? 0}</p>
                  <p className="label-mono-sm mt-1">menciones</p>
                </div>
                <p className="label-mono-sm flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3" />
                  {relativeTime(project.lastRunAt)}
                </p>
              </div>

              {project.lastRunError && (
                <p className="line-clamp-2 font-mono text-[10px] leading-snug text-warning">
                  {project.lastRunError}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo proyecto de escucha">
        <ProjectForm draft={draft} onChange={setDraft} providers={providers} />
        <div className="mt-6 flex justify-end gap-2 border-t border-hairline pt-4">
          <button onClick={() => setCreating(false)} className="tbtn">
            Cancelar
          </button>
          <button
            onClick={create}
            disabled={saving || !draft.name.trim() || !draft.entities.some((e) => e.name.trim())}
            className="rounded-[9px] bg-primary px-4 py-2 text-sm font-semibold text-primary-fg transition-all disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? "Creando..." : "Crear proyecto"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
