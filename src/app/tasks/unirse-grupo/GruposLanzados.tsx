"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Tag } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { STATUS_COLORS } from "@/components/StatusBadge";

export type GroupProfileState = "member" | "requested" | "running" | "paused" | "failed";

export type LaunchedGroup = {
  url: string;
  /** Vacío hasta que alguna tarea lo lea de la página del grupo. */
  name: string;
  lastAt: string;
  counts: Record<GroupProfileState, number>;
  profiles: { profileId: string; name: string; state: GroupProfileState }[];
};

// Los colores salen de StatusBadge, así un "En curso" o un "Pausados" se leen
// igual acá que en la tabla de tareas.
const ESTADOS: Record<GroupProfileState, { label: string; color: string }> = {
  member: { label: "Unido", color: STATUS_COLORS.success },
  requested: { label: "Solicitud enviada", color: STATUS_COLORS.partial },
  running: { label: "En curso", color: STATUS_COLORS.running },
  paused: { label: "Pausados", color: STATUS_COLORS.paused },
  failed: { label: "Falló", color: STATUS_COLORS.failed },
};

function Pill({ label, color, count, title }: { label: string; color: string; count?: number; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] px-2 py-0.5 text-[11px] font-medium"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      {count !== undefined && <span className="font-mono">{count}</span>}
      {label}
    </span>
  );
}

export function EstadoPill({ state }: { state: GroupProfileState }) {
  return <Pill {...ESTADOS[state]} />;
}

/** El id o alias del grupo: lo único legible que trae el link. */
function idDelLink(url: string) {
  return url.match(/\/groups\/([^/]+)/)?.[1] ?? url;
}

export default function GruposLanzados({
  groups,
  loading,
  onUse,
}: {
  groups: LaunchedGroup[];
  loading: boolean;
  onUse: (url: string) => void;
}) {
  const sinNombre = groups.filter((g) => !g.name).length;
  const [leyendo, setLeyendo] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; text: string; taskId?: string } | null>(null);

  async function traerNombres() {
    setLeyendo(true);
    setAviso(null);
    try {
      const r = await apiFetch<{ taskId: string; grupos: number }>("/api/tasks/join-groups/names", { method: "POST" });
      setAviso({
        ok: true,
        text: `Se encoló una tarea que va a leer el nombre de ${r.grupos} grupo${r.grupos === 1 ? "" : "s"}. Recarga en unos minutos.`,
        taskId: r.taskId,
      });
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLeyendo(false);
    }
  }

  return (
    <section className="card-surface flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">Grupos lanzados</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Cuántos perfiles ya entraron a cada grupo y cuántos siguen en curso. &quot;Unidos&quot; incluye las
            solicitudes que esperan la aprobación de los admins.
          </p>
        </div>
        {sinNombre > 0 && (
          <button
            type="button"
            onClick={traerNombres}
            disabled={leyendo}
            title="Facebook no muestra el nombre sin sesión: un perfil logueado pasa por cada grupo y lo lee"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-page hover:text-ink disabled:opacity-50"
          >
            <Tag className="h-3.5 w-3.5" />
            {leyendo ? "Encolando…" : `Traer nombres (${sinNombre})`}
          </button>
        )}
      </div>

      {aviso && (
        <p className={`text-xs ${aviso.ok ? "text-success" : "text-critical"}`}>
          {aviso.text}{" "}
          {aviso.taskId && (
            <Link href={`/tasks/${aviso.taskId}`} className="underline">
              Ver tarea
            </Link>
          )}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-ink-muted">Todavía no se mandó ningún perfil a un grupo.</p>
      ) : (
        <div className="flex flex-col divide-y divide-hairline">
          {groups.map((g) => {
            const unidos = g.counts.member + g.counts.requested;
            return (
              <div key={g.url} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{g.name || idDelLink(g.url)}</span>
                  {g.name && <span className="truncate text-xs text-ink-muted">{idDelLink(g.url)}</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Pill
                    label="Unidos"
                    color={ESTADOS.member.color}
                    count={unidos}
                    title={`${g.counts.member} unidos · ${g.counts.requested} con solicitud enviada`}
                  />
                  {g.counts.running > 0 && <Pill {...ESTADOS.running} count={g.counts.running} />}
                  {g.counts.paused > 0 && (
                    <Pill
                      {...ESTADOS.paused}
                      count={g.counts.paused}
                      title="Su campaña está pausada: no avanzan hasta que se reanude"
                    />
                  )}
                </div>
                <div className="ml-auto flex items-center gap-3 text-xs">
                  <a
                    href={g.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                  >
                    Abrir <ExternalLink className="h-3 w-3" />
                  </a>
                  <button type="button" onClick={() => onUse(g.url)} className="text-primary hover:underline">
                    Mandar más perfiles
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
