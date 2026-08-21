"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { use } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Sparkles,
  Settings2,
  Play,
  Pause,
  Trash2,
  BrainCircuit,
  Radio,
  Megaphone,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { apiFetch } from "@/lib/api";
import Modal from "@/components/Modal";
import Panel from "@/components/ui/Panel";
import SubHead from "@/components/ui/SubHead";
import Num from "@/components/ui/Num";
import Pagination from "@/components/Pagination";
import ElementIcon from "@/components/ui/ElementIcon";
import MentionCard, { type MentionRow } from "@/components/listening/MentionCard";
import { BRIEF_ICON_MAP, normalizePoints, type BriefPoint } from "@/components/listening/briefIcons";
import ProjectForm, { type ProjectDraft } from "@/components/listening/ProjectForm";
import { AXIS_TICK, GRID_STROKE, BASELINE_STROKE, TOOLTIP_BOX } from "@/components/charts/chartTheme";

type Project = ProjectDraft & { _id: string; status: "active" | "paused"; mentionCount: number };

type NamedRow = {
  name: string;
  count: number;
  avgScore: number | null;
  followers: number | null;
  reach: number;
  engagement: number;
  lastAt: string | null;
};

// Nombre presentable y color de cada fuente. La clave es el campo `platform`
// que guarda la ingesta.
//
// Son colores categóricos: lo único que importa es que ninguna fila comparta
// tono con otra. Por eso ninguno sale de los tokens --el-*, que desde que se
// quitaron los colores por sección resuelven todos al mismo acento y habrían
// dejado tres redes pintadas igual.
const PLATFORM_META: Record<string, { label: string; color: string }> = {
  news: { label: "Prensa y web", color: "var(--gold)" },
  x: { label: "X (Twitter)", color: "var(--series-6)" },
  instagram: { label: "Instagram", color: "var(--series-3)" },
  tiktok: { label: "TikTok", color: "var(--teal)" },
  facebook: { label: "Facebook", color: "var(--blue)" },
  linkedin: { label: "LinkedIn", color: "var(--series-2)" },
  youtube: { label: "YouTube", color: "var(--danger)" },
};

type Stats = {
  totals: { total: number; analyzed: number; avgScore: number | null; reach: number; engagement: number };
  daily: { day: string; total: number; positive: number; neutral: number; negative: number }[];
  byEntity: NamedRow[];
  bySource: NamedRow[];
  byPlatform: NamedRow[];
  topTopics: NamedRow[];
  topAuthors: NamedRow[];
};

type Brief = {
  _id?: string;
  from?: string;
  to?: string;
  windowStart?: string | null;
  partial?: boolean;
  createdAt?: string;
  snapshot?: { mentions: number; avgScore: number | null; negative: number };
  headline: string;
  narrative: string;
  risks: (string | BriefPoint)[];
  opportunities: (string | BriefPoint)[];
  recommendations: (string | BriefPoint)[];
};

/** Una ventana de la grilla de tres días (ver src/lib/listening/briefWindows.ts). */
type ScheduledWindow = {
  index: number;
  startDay: string;
  endDay: string;
  closed: boolean;
  mentions: number;
  briefId: string | null;
  partial: boolean;
  pending: boolean;
};

type BriefSchedule = {
  anchorDay: string | null;
  windowDays: number;
  windows: ScheduledWindow[];
  pending: ScheduledWindow[];
  current: ScheduledWindow | null;
};

// Cuántas ventanas se muestran sin desplegar. Un proyecto con medio año de
// historial tiene sesenta chips: de a dieciséis la tira sigue leyéndose de un
// vistazo y el resto queda a un clic.
const VISIBLE_WINDOWS = 16;

// Tope de informes que genera un solo clic en "Generar pendientes". Cada uno es
// una llamada con razonamiento profundo sobre cientos de menciones, así que un
// proyecto con meses de atraso podría encadenar decenas sin este freno.
const MAX_BRIEF_BATCH = 12;

const PRESETS = [
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
  { label: "90 días", days: 90 },
];

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `2026-08-13` → `13 ago`. En UTC, que es la zona en que se cortan los días. */
function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Color de un score de sentimiento. La banda muerta de ±10 existe porque un
 * promedio de 4 puntos sobre cien menciones no es "favorable", es ruido.
 */
function scoreTone(score: number | null | undefined): string {
  if (score === null || score === undefined) return "var(--text-muted)";
  if (score > 10) return "var(--ok)";
  if (score < -10) return "var(--danger)";
  return "var(--amber)";
}

// "Sin analizar" es una serie más, no una ausencia: si no estuviera, una
// corrida recién hecha (todavía sin pasar por la IA) dibujaría la gráfica en
// cero aunque hubiera decenas de menciones.
const SENTIMENT_SERIES = [
  { key: "positive", name: "Favorable", color: "var(--ok)" },
  { key: "neutral", name: "Neutral", color: "var(--text-muted)" },
  { key: "negative", name: "Adverso", color: "var(--danger)" },
  // Color categórico y no el acento: las cuatro bandas del área apilada tienen
  // que leerse por separado.
  { key: "unanalyzed", name: "Sin analizar", color: "var(--series-3)" },
] as const;

const inputClass =
  "rounded-[9px] border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary";

/** Cifra con una línea que explica qué mide, para que el dato no quede solo. */
function Kpi({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string | number;
  hint: string;
  color?: string;
}) {
  return (
    <div
      className="card-surface c3 flex min-h-26 flex-col px-4.5 py-4"
      style={color ? { ["--edge-c" as string]: color } : undefined}
    >
      <span className="label-mono">{label}</span>
      <span className="stat-value mt-2.5" style={color ? { color } : undefined}>
        {typeof value === "number" ? <Num t={value} /> : value}
      </span>
      <span className="mt-2 text-[10.5px] leading-snug text-ink-muted">{hint}</span>
    </div>
  );
}

export default function ProyectoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [project, setProject] = useState<Project | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mentions, setMentions] = useState<MentionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"run" | "analyze" | "brief" | null>(null);

  // "Hoy" se fija una vez al montar. Leerlo en cada render es impuro y hace
  // que los presets se recalculen solos si la página queda abierta al cruzar
  // la medianoche.
  const [todayIso] = useState(() => isoDay(new Date()));
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(todayIso);

  const [sentiment, setSentiment] = useState("");
  const [entity, setEntity] = useState("");
  // "relevant" (default) | "irrelevant" | "all"
  const [relevance, setRelevance] = useState("relevant");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefHistory, setBriefHistory] = useState<Brief[]>([]);
  const [schedule, setSchedule] = useState<BriefSchedule | null>(null);
  const [briefProgress, setBriefProgress] = useState<string | null>(null);
  const [allWindows, setAllWindows] = useState(false);
  // Corta el bucle de "generar pendientes" entre informe e informe. Va en una
  // ref y no en estado porque el bucle es una función async que ya capturó su
  // render: un `useState` le quedaría siempre en false.
  const stopBriefs = useRef(false);
  // Colapsado por defecto: el informe completo ocupa más de una pantalla y
  // empuja el feed de menciones fuera de vista.
  const [briefOpen, setBriefOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);

  const PAGE_SIZE = 25;

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadProject = useCallback(async () => {
    const data = await apiFetch<{ project: Project }>(`/api/listening/projects/${id}`);
    setProject(data.project);
  }, [id]);

  const loadStats = useCallback(async () => {
    const data = await apiFetch<Stats>(
      `/api/listening/projects/${id}/stats?from=${from}&to=${to}`,
    );
    setStats(data);
  }, [id, from, to]);

  const loadMentions = useCallback(async () => {
    const sp = new URLSearchParams({
      projectId: id,
      from,
      to,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    sp.set("relevance", relevance);
    if (sentiment) sp.set("sentiment", sentiment);
    if (entity) sp.set("entity", entity);
    if (search) sp.set("search", search);

    const data = await apiFetch<{ mentions: MentionRow[]; total: number }>(
      `/api/listening/mentions?${sp}`,
    );
    setMentions(data.mentions);
    setTotal(data.total);
  }, [id, from, to, page, sentiment, entity, search, relevance]);

  const loadBriefs = useCallback(async () => {
    // El límite alto no es capricho: la tira de períodos resuelve cada clic
    // contra esta lista, así que un historial más corto que la grilla dejaría
    // ventanas ya generadas que no abren nada al clickearlas.
    const data = await apiFetch<{ briefs: Brief[]; schedule: BriefSchedule }>(
      `/api/listening/projects/${id}/briefs?limit=200`,
    );
    setBriefHistory(data.briefs);
    setSchedule(data.schedule);
    // Al entrar se muestra el último guardado: el informe deja de perderse
    // al recargar la página.
    setBrief((current) => current ?? data.briefs[0] ?? null);
  }, [id]);

  const reloadAll = useCallback(async () => {
    try {
      await Promise.all([loadProject(), loadStats(), loadMentions(), loadBriefs()]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadProject, loadStats, loadMentions, loadBriefs]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  async function run() {
    setBusy("run");
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{
        report: { saved: number; fetched: number; filtered: number; errors: string[] };
        analyzed: number;
        analysisError: string | null;
      }>(`/api/listening/projects/${id}/run`, { method: "POST" });

      const parts = [
        `${res.report.saved} menciones nuevas de ${res.report.fetched} traídas`,
        res.report.filtered > 0 ? `${res.report.filtered} filtradas` : "",
        res.analyzed > 0 ? `${res.analyzed} analizadas` : "",
        res.analysisError ? `IA: ${res.analysisError}` : "",
        ...res.report.errors,
      ].filter(Boolean);
      setNotice(parts.join(" · "));

      await reloadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function analyze(reanalyze = false) {
    setBusy("analyze");
    setError(null);
    try {
      const res = await apiFetch<{ analyzed: number }>(
        `/api/listening/projects/${id}/analyze?reanalyze=${reanalyze ? "1" : "0"}`,
        { method: "POST" },
      );
      setNotice(`${res.analyzed} menciones analizadas`);
      await reloadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  type BriefResponse = { brief: Brief | null; window: ScheduledWindow | null; pending: number };

  /**
   * Pide UN informe y devuelve la respuesta cruda. El servidor nunca genera
   * más de uno por llamada: encadenar varias ventanas de razonamiento profundo
   * en un mismo request se lleva puesto cualquier timeout.
   */
  const requestBrief = useCallback(
    async (body: Record<string, unknown>) =>
      apiFetch<BriefResponse>(`/api/listening/projects/${id}/brief`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    [id],
  );

  /**
   * Cierra las ventanas de tres días que falten, de la más vieja a la más
   * nueva. Se detiene al llegar al tope del lote, cuando el usuario aprieta
   * "detener", o cuando el servidor contesta que no queda ninguna.
   */
  async function generatePendingBriefs() {
    setBusy("brief");
    setError(null);
    setNotice(null);
    stopBriefs.current = false;

    let done = 0;
    try {
      for (let i = 0; i < MAX_BRIEF_BATCH && !stopBriefs.current; i += 1) {
        const res = await requestBrief({});
        if (!res.brief) break;

        done += 1;
        setBrief(res.brief);
        setBriefProgress(
          `${done} informe${done === 1 ? "" : "s"} generado${done === 1 ? "" : "s"} · ${res.pending} pendiente${res.pending === 1 ? "" : "s"}`,
        );
        await loadBriefs();
        if (res.pending <= 0) break;
      }

      setNotice(
        done === 0
          ? "No hay períodos pendientes por analizar."
          : `${done} informe(s) generado(s).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBriefProgress(null);
      setBusy(null);
    }
  }

  /** Genera o rehace una ventana puntual de la grilla. */
  async function generateWindow(startDay: string) {
    setBusy("brief");
    setError(null);
    try {
      const res = await requestBrief({ windowStart: startDay });
      if (res.brief) setBrief(res.brief);
      await loadBriefs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Adelanto de la ventana en curso: queda parcial y se rehace al cerrar. */
  async function generateCurrentBrief() {
    setBusy("brief");
    setError(null);
    try {
      const res = await requestBrief({ current: true });
      if (res.brief) setBrief(res.brief);
      await loadBriefs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Informe suelto del período que muestra la barra de arriba, fuera de la grilla. */
  async function generateRangeBrief() {
    setBusy("brief");
    setError(null);
    try {
      const res = await requestBrief({ from, to });
      if (res.brief) setBrief(res.brief);
      await loadBriefs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus() {
    if (!project) return;
    await apiFetch(`/api/listening/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: project.status === "active" ? "paused" : "active" }),
    });
    await loadProject();
  }

  async function saveSettings() {
    if (!draft) return;
    await apiFetch(`/api/listening/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...draft, entities: draft.entities.filter((e) => e.name.trim()) }),
    });
    setEditing(false);
    await reloadAll();
  }

  async function purgeIrrelevant() {
    if (!confirm("¿Borrar todas las menciones que la IA marcó como ajenas a la figura?")) return;
    try {
      const res = await apiFetch<{ deleted: number }>(
        `/api/listening/mentions?projectId=${id}&relevance=irrelevant`,
        { method: "DELETE" },
      );
      setNotice(`${res.deleted} menciones descartadas eliminadas`);
      await reloadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!confirm("¿Borrar el proyecto y todas sus menciones? No se puede deshacer.")) return;
    await apiFetch(`/api/listening/projects/${id}`, { method: "DELETE" });
    window.location.href = "/scrapping";
  }

  const avgScore = stats?.totals.avgScore;
  const scoreColor = scoreTone(avgScore);

  const dailyChart = useMemo(
    () =>
      (stats?.daily ?? []).map((d) => ({
        ...d,
        label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
          timeZone: "UTC",
        }),
      })),
    [stats],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pendingWindows = schedule?.pending.length ?? 0;
  // Los de rango libre no entran en la tira de períodos (no pertenecen a
  // ninguna ventana), así que llevan su propia fila al pie del panel.
  const rangeBriefs = useMemo(() => briefHistory.filter((b) => !b.windowStart), [briefHistory]);

  return (
    <div className="flex animate-fade-in-up flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/scrapping"
            className="label-mono-sm inline-flex items-center gap-1.5 transition-colors hover:text-gold"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Escucha
          </Link>
          <div className="mt-2 flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] accent-fill border">
              <ElementIcon name="viento" size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold text-ink">{project?.name ?? "…"}</h1>
              <p className="label-mono-sm mt-1 normal-case tracking-normal">
                {project?.entities.map((e) => e.name).join(" · ")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/scrapping/proyecto/${id}/publicaciones`}
            className="tbtn inline-flex items-center gap-1.5 text-viento"
            style={{ borderColor: "color-mix(in srgb, var(--el-viento) 45%, transparent)" }}
          >
            <Megaphone className="h-3.5 w-3.5" /> Publicaciones +
          </Link>
          <button onClick={run} disabled={busy !== null} className="tbtn inline-flex items-center gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${busy === "run" ? "animate-spin" : ""}`} />
            {busy === "run" ? "Buscando..." : "Buscar ahora"}
          </button>
          <button onClick={() => analyze(false)} disabled={busy !== null} className="tbtn inline-flex items-center gap-1.5">
            <BrainCircuit className={`h-3.5 w-3.5 ${busy === "analyze" ? "animate-pulse" : ""}`} />
            Analizar
          </button>
          <button onClick={toggleStatus} className="tbtn inline-flex items-center gap-1.5">
            {project?.status === "active" ? (
              <>
                <Pause className="h-3.5 w-3.5" /> Pausar
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Activar
              </>
            )}
          </button>
          <button
            onClick={() => {
              if (project) setDraft(project);
              setEditing(true);
            }}
            className="tbtn inline-flex items-center gap-1.5"
          >
            <Settings2 className="h-3.5 w-3.5" /> Configurar
          </button>
          <button
            onClick={remove}
            className="tbtn inline-flex items-center gap-1.5 hover:border-critical hover:text-critical"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-[9px] border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-[9px] border border-hairline bg-surface-2 p-3 font-mono text-[11px] text-ink-secondary">
          {notice}
        </p>
      )}

      {/* Rango de fechas: los presets cubren el 90% de los casos y el rango
          manual queda para cuando se investiga un episodio puntual. */}
      <div className="card-surface flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="label-mono">Período</span>
        {PRESETS.map((preset) => {
          const presetFrom = isoDay(
            new Date(new Date(`${todayIso}T00:00:00Z`).getTime() - (preset.days - 1) * 86400000),
          );
          const active = from === presetFrom && to === todayIso;
          return (
            <button
              key={preset.days}
              onClick={() => {
                setFrom(presetFrom);
                setTo(todayIso);
                setPage(1);
              }}
              className={`rounded-[7px] border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                active ? "accent-fill" : "border-hairline text-ink-secondary hover:text-ink"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        <span className="label-mono-sm ml-2">del</span>
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          className={`${inputClass} py-1 font-mono text-[11px]`}
        />
        <span className="label-mono-sm">al</span>
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          className={`${inputClass} py-1 font-mono text-[11px]`}
        />
      </div>

      <div className="bento">
        <Kpi
          label="Menciones"
          value={stats?.totals.total ?? 0}
          hint="Publicaciones y notas encontradas en el período. Cada una cuenta una vez por figura."
        />
        <Kpi
          label="Sentimiento promedio"
          value={avgScore === null || avgScore === undefined ? "—" : Math.round(avgScore)}
          color={scoreColor}
          hint={`De -100 (demoledor) a +100 (muy favorable). Promedia solo lo ya clasificado: ${stats?.totals.analyzed ?? 0} de ${stats?.totals.total ?? 0}.`}
        />
        <Kpi
          label="Alcance estimado"
          value={stats?.totals.reach ?? 0}
          hint="Suma de seguidores de quienes publicaron. Cuánta gente pudo verlo, no cuánta lo vio. Las notas de prensa no aportan."
        />
        <Kpi
          label="Interacciones"
          value={stats?.totals.engagement ?? 0}
          hint="Likes, comentarios y compartidos sumados. Mide reacción real, no exposición. Solo existe en redes."
        />

        <SubHead>Evolución</SubHead>

        <Panel
          col={8}
          title="Volumen y sentimiento por día"
          tag="menciones"
          accent="var(--el-viento)"
          icon={<ElementIcon name="viento" size={13} />}
        >
          {dailyChart.length === 0 ? (
            <p className="flex h-56 items-center justify-center font-mono text-[11px] text-ink-muted">
              Sin menciones en el período.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dailyChart} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  {SENTIMENT_SERIES.map((s) => (
                    <linearGradient key={s.key} id={`sent-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: BASELINE_STROKE }} tick={AXIS_TICK} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={38} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: BASELINE_STROKE, strokeWidth: 1 }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className={TOOLTIP_BOX}>
                        <p className="mb-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-muted">{label}</p>
                        {payload.map((p) => (
                          <div key={String(p.dataKey)} className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-xs" style={{ background: p.color }} />
                            <span className="font-semibold tabular-nums text-ink">{p.value}</span>
                            <span className="text-ink-muted">{p.name}</span>
                          </div>
                        ))}
                      </div>
                    ) : null
                  }
                />
                {/* Apiladas: lo que interesa es la composición del volumen,
                    no tres curvas independientes que se tapan entre sí. */}
                {SENTIMENT_SERIES.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    stackId="1"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={1.5}
                    fill={`url(#sent-${s.key})`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel
          col={4}
          title="Share of voice"
          tag="por figura"
          accent="var(--gold)"
          icon={<ElementIcon name="eye" size={13} />}
        >
          {(stats?.byEntity.length ?? 0) === 0 ? (
            <p className="flex h-56 items-center justify-center font-mono text-[11px] text-ink-muted">
              Sin datos.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {stats!.byEntity.map((row) => {
                const max = Math.max(...stats!.byEntity.map((r) => r.count));
                const pct = max > 0 ? (row.count / max) * 100 : 0;
                const tone = scoreTone(row.avgScore);
                return (
                  <div key={row.name}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium text-ink">{row.name}</span>
                      <span className="font-mono text-[11px] tabular-nums" style={{ color: tone }}>
                        {row.count}
                        {row.avgScore !== null ? ` · ${Math.round(row.avgScore)}` : ""}
                      </span>
                    </div>
                    <div className="h-1.75 overflow-hidden rounded-full bg-gridline">
                      <div
                        className="bar-grow h-full rounded-full"
                        style={{ width: `${pct}%`, background: tone }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <SubHead>Por red social</SubHead>

        <Panel
          col={12}
          title="De dónde llega el dato"
          tag="una fila por fuente activa"
          accent="var(--el-agua)"
          icon={<Radio className="h-3.5 w-3.5" />}
        >
          {(stats?.byPlatform.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-secondary">
              Todavía no llegó nada. Corré &quot;Buscar ahora&quot; o revisá que las redes tengan
              cuentas cargadas en Configurar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-left">
                <thead>
                  <tr>
                    {["Red", "Menciones", "Sentimiento", "Alcance", "Interacciones", "Último"].map((h) => (
                      <th
                        key={h}
                        className="border-b border-hairline px-2 pb-2 font-mono text-[9px] uppercase tracking-[0.09em] text-ink-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats!.byPlatform.map((row) => {
                    const meta = PLATFORM_META[row.name] ?? { label: row.name, color: "var(--gold)" };
                    const tone = scoreTone(row.avgScore);
                    return (
                      <tr key={row.name} className="border-b border-hairline last:border-0">
                        <td className="px-2 py-2.5">
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 shrink-0 rounded-xs"
                              style={{ background: meta.color }}
                            />
                            <span className="text-[13px] font-medium text-ink">{meta.label}</span>
                          </span>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[12px] tabular-nums text-ink">
                          {row.count}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[12px] tabular-nums" style={{ color: tone }}>
                          {row.avgScore === null ? "sin analizar" : Math.round(row.avgScore)}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[12px] tabular-nums text-ink-secondary">
                          {row.reach ? row.reach.toLocaleString("es-MX") : "—"}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[12px] tabular-nums text-ink-secondary">
                          {row.engagement ? row.engagement.toLocaleString("es-MX") : "—"}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[11px] text-ink-muted">
                          {row.lastAt
                            ? new Date(row.lastAt).toLocaleDateString("es-MX", {
                                day: "2-digit",
                                month: "short",
                              })
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel col={4} title="Fuentes más activas" tag="dominios" accent="var(--el-agua)">
          <TopList rows={stats?.bySource ?? []} color="var(--el-agua)" />
        </Panel>
        <Panel col={4} title="Temas dominantes" tag="detectados por IA" accent="var(--el-tierra)">
          <TopList rows={stats?.topTopics ?? []} color="var(--el-tierra)" />
        </Panel>
        <Panel col={4} title="Voces más frecuentes" tag="autores" accent="var(--el-fuego)">
          <TopList rows={stats?.topAuthors ?? []} color="var(--el-fuego)" />
        </Panel>

        <SubHead>Lectura del período</SubHead>

        <Panel
          col={12}
          title="Resumen ejecutivo"
          tag={`cada ${schedule?.windowDays ?? 3} días · Claude`}
          accent="var(--gold)"
          icon={<Sparkles className="h-3.5 w-3.5" />}
          right={
            <div className="flex items-center gap-2">
              {brief && (
                <button
                  onClick={() => setBriefOpen((v) => !v)}
                  className="tbtn inline-flex items-center gap-1.5"
                >
                  {briefOpen ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" /> Contraer
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" /> Ver completo
                    </>
                  )}
                </button>
              )}
              {briefProgress !== null && (
                <button onClick={() => (stopBriefs.current = true)} className="tbtn">
                  Detener
                </button>
              )}
              <button
                onClick={generatePendingBriefs}
                disabled={busy !== null || pendingWindows === 0}
                className="tbtn"
              >
                {busy === "brief"
                  ? "Analizando..."
                  : pendingWindows === 0
                    ? "Al día"
                    : `Generar pendientes (${pendingWindows})`}
              </button>
            </div>
          }
        >
          {/* La tira de períodos es el índice del módulo: cada casilla es una
              ventana de tres días, y de un vistazo se ve cuáles ya se leyeron,
              cuáles faltan y cómo venía el sentimiento en cada una. */}
          {schedule && schedule.windows.length > 0 && (
            <div className="mb-4 flex flex-col gap-2.5 border-b border-hairline pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="label-mono">Períodos de {schedule.windowDays} días</span>
                {briefProgress && (
                  <span className="label-mono-sm normal-case tracking-normal text-gold">
                    {briefProgress}
                  </span>
                )}
                {schedule.current && (
                  <button
                    onClick={generateCurrentBrief}
                    disabled={busy !== null}
                    className="tbtn ml-auto"
                    title="Genera un adelanto del período que todavía no termina. Se reemplaza solo cuando cierre."
                  >
                    Adelanto del período en curso
                  </button>
                )}
              </div>

              <WindowStrip
                windows={schedule.windows}
                expanded={allWindows}
                onToggleExpand={() => setAllWindows((v) => !v)}
                activeBriefId={brief?._id ?? null}
                disabled={busy !== null}
                onView={(briefId) => {
                  const found = briefHistory.find((b) => b._id === briefId);
                  if (found) setBrief(found);
                }}
                onGenerate={generateWindow}
              />
            </div>
          )}

          {!brief ? (
            <p className="py-6 text-center text-[13px] text-ink-secondary">
              {schedule?.anchorDay
                ? `Hay ${pendingWindows} período(s) de ${schedule.windowDays} días sin analizar. Genéralos para tener la lectura de cada tramo: qué se movió, qué riesgos hay y qué hacer al respecto.`
                : "Todavía no hay menciones de las cuales sacar una lectura. Corré “Buscar ahora” primero."}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {(brief.from || brief.snapshot) && (
                <p className="label-mono-sm flex flex-wrap items-center gap-x-1.5 normal-case tracking-normal">
                  {brief.from && brief.to && (
                    <span>
                      Período {new Date(brief.from).toLocaleDateString("es-MX", { timeZone: "UTC" })} –{" "}
                      {new Date(brief.to).toLocaleDateString("es-MX", { timeZone: "UTC" })}
                    </span>
                  )}
                  {!brief.windowStart && <span className="pill-mono">rango libre</span>}
                  {brief.partial && <span className="pill-mono text-amber">adelanto</span>}
                  {brief.snapshot && (
                    <span>
                      · {brief.snapshot.mentions} menciones · sentimiento{" "}
                      {brief.snapshot.avgScore ?? "—"} · {brief.snapshot.negative} adversas
                    </span>
                  )}
                  {brief.createdAt && (
                    <span>· generado el {new Date(brief.createdAt).toLocaleString("es-MX")}</span>
                  )}
                  {brief.windowStart && (
                    <button
                      onClick={() => generateWindow(String(brief.windowStart).slice(0, 10))}
                      disabled={busy !== null}
                      className="underline transition-colors hover:text-gold"
                    >
                      rehacer
                    </button>
                  )}
                </p>
              )}
              <h3 className="font-display text-xl font-semibold leading-snug text-ink">{brief.headline}</h3>
              {briefOpen ? (
                <>
                  <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-secondary">
                    {brief.narrative}
                  </p>
                  <div className="grid gap-4 md:grid-cols-3">
                    <BriefList title="Riesgos" items={brief.risks} color="var(--danger)" fallbackIcon="alerta" />
                    <BriefList
                      title="Oportunidades"
                      items={brief.opportunities}
                      color="var(--ok)"
                      fallbackIcon="oportunidad"
                    />
                    <BriefList
                      title="Recomendaciones"
                      items={brief.recommendations}
                      color="var(--gold)"
                      fallbackIcon="comunicacion"
                    />
                  </div>
                </>
              ) : (
                <button
                  onClick={() => setBriefOpen(true)}
                  className="label-mono self-start transition-colors hover:text-gold"
                >
                  {brief.risks.length} riesgos · {brief.opportunities.length} oportunidades ·{" "}
                  {brief.recommendations.length} recomendaciones — ver completo →
                </button>
              )}
            </div>
          )}

          {/* Salida de emergencia: un informe del rango que muestra la barra de
              arriba, fuera de la grilla. Sirve para investigar un episodio
              puntual sin ensuciar la serie de tres días. */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
            <span className="label-mono">Rango libre</span>
            <button onClick={generateRangeBrief} disabled={busy !== null} className="tbtn">
              Analizar {from} → {to}
            </button>
            {rangeBriefs.map((b) => (
              <button
                key={b._id}
                onClick={() => setBrief(b)}
                title={`${b.snapshot?.mentions ?? 0} menciones · sentimiento ${b.snapshot?.avgScore ?? "—"}`}
                className={`rounded-[7px] border px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
                  brief?._id === b._id
                    ? "accent-fill"
                    : "border-hairline text-ink-secondary hover:text-ink"
                }`}
              >
                {shortDay(String(b.from).slice(0, 10))} → {shortDay(String(b.to).slice(0, 10))}
              </button>
            ))}
          </div>
        </Panel>

        <SubHead>Menciones</SubHead>

        <div className="c12 flex flex-col gap-3.5">
          <div className="card-surface flex flex-wrap items-center gap-2 px-4 py-3">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar en el texto, autor o medio..."
              className={`${inputClass} min-w-50 flex-1`}
            />
            <select
              value={sentiment}
              onChange={(e) => {
                setSentiment(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="">Todo sentimiento</option>
              <option value="positive">Favorable</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Adverso</option>
            </select>
            <select
              value={relevance}
              onChange={(e) => {
                setRelevance(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="relevant">Solo relevantes</option>
              <option value="irrelevant">Solo descartadas</option>
              <option value="all">Todas</option>
            </select>
            <select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="">Todas las figuras</option>
              {project?.entities.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
            <button onClick={() => analyze(true)} disabled={busy !== null} className="tbtn">
              Reanalizar todo
            </button>
            {relevance === "irrelevant" && total > 0 && (
              <button
                onClick={purgeIrrelevant}
                className="tbtn hover:border-critical hover:text-critical"
              >
                Borrar estas {total}
              </button>
            )}
          </div>

          {mentions.length === 0 ? (
            <div className="card-surface px-8 py-12 text-center">
              <p className="text-[13px] text-ink-secondary">
                No hay menciones que coincidan. Prueba con &quot;Buscar ahora&quot; o amplía el período.
              </p>
            </div>
          ) : (
            <>
              {mentions.map((mention) => (
                <MentionCard key={mention._id} mention={mention} />
              ))}
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={PAGE_SIZE}
                onChange={setPage}
              />
            </>
          )}
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Configuración del proyecto">
        {draft && <ProjectForm draft={draft} onChange={setDraft} providers={[]} />}
        <div className="mt-6 flex justify-end gap-2 border-t border-hairline pt-4">
          <button onClick={() => setEditing(false)} className="tbtn">
            Cancelar
          </button>
          <button
            onClick={saveSettings}
            className="rounded-[9px] bg-primary px-4 py-2 text-sm font-semibold text-primary-fg"
          >
            Guardar
          </button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * La grilla de ventanas como una tira de casillas: hechas, pendientes, en
 * curso y vacías. Clickear una hecha la muestra; clickear una pendiente la
 * genera, que es la forma de recuperar un solo período sin disparar el lote
 * entero.
 */
function WindowStrip({
  windows,
  expanded,
  onToggleExpand,
  activeBriefId,
  disabled,
  onView,
  onGenerate,
}: {
  windows: ScheduledWindow[];
  expanded: boolean;
  onToggleExpand: () => void;
  activeBriefId: string | null;
  disabled: boolean;
  onView: (briefId: string) => void;
  onGenerate: (startDay: string) => void;
}) {
  const shown = expanded ? windows : windows.slice(-VISIBLE_WINDOWS);
  const hidden = windows.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {hidden > 0 && (
        <button onClick={onToggleExpand} className="label-mono transition-colors hover:text-gold">
          +{hidden} anteriores
        </button>
      )}
      {expanded && windows.length > VISIBLE_WINDOWS && (
        <button onClick={onToggleExpand} className="label-mono transition-colors hover:text-gold">
          − contraer
        </button>
      )}

      {shown.map((window) => {
        const label = `${shortDay(window.startDay)} → ${shortDay(window.endDay)}`;
        const active = Boolean(window.briefId) && window.briefId === activeBriefId;
        const empty = window.mentions === 0;

        const title = empty
          ? `${label} · sin menciones en el período`
          : window.briefId
            ? `${label} · ${window.mentions} menciones${window.partial ? " · adelanto, se rehará al cerrar" : ""} — clic para ver`
            : `${label} · ${window.mentions} menciones${window.closed ? "" : " · el período sigue abierto"} — clic para analizarlo`;

        // Cuatro estados y cuatro tratamientos: el hecho tiene borde sólido, el
        // adelanto y el pendiente van punteados (les falta algo), y el vacío se
        // apaga porque no hay nada que se pueda hacer con él.
        const tone = window.briefId
          ? window.partial
            ? "border-dashed border-amber/55 text-amber"
            : active
              ? "accent-fill"
              : "border-gold/40 text-ink-secondary hover:text-ink"
          : empty
            ? "border-dashed border-hairline text-ink-muted opacity-45"
            : window.closed
              ? "border-dashed border-hairline text-ink-secondary hover:border-gold/50 hover:text-gold"
              : "border-dotted border-viento/55 text-viento";

        return (
          <button
            key={window.startDay}
            title={title}
            disabled={disabled || empty}
            onClick={() =>
              window.briefId ? onView(window.briefId) : onGenerate(window.startDay)
            }
            className={`rounded-[7px] border px-2 py-1 font-mono text-[10px] transition-colors disabled:cursor-not-allowed ${tone}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function TopList({ rows, color }: { rows: NamedRow[]; color: string }) {
  if (rows.length === 0) {
    return (
      <p className="flex h-32 items-center justify-center font-mono text-[11px] text-ink-muted">
        Sin datos.
      </p>
    );
  }
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 26)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
        <XAxis type="number" hide domain={[0, max]} />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: "var(--gridline)", fillOpacity: 0.5 }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className={TOOLTIP_BOX}>
                <span className="font-semibold tabular-nums text-ink">{payload[0].value}</span>{" "}
                <span className="text-ink-muted">menciones</span>
              </div>
            ) : null
          }
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={14}>
          {rows.map((row, i) => (
            <Cell key={row.name} fill={color} fillOpacity={1 - i * 0.06} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function BriefList({
  title,
  items,
  color,
  fallbackIcon,
}: {
  title: string;
  items: (string | BriefPoint)[];
  color: string;
  fallbackIcon: string;
}) {
  const points = normalizePoints(items, fallbackIcon);

  return (
    <div>
      <p className="label-mono mb-2.5" style={{ color }}>
        {title}
      </p>
      <ul className="flex flex-col gap-3">
        {points.map((point, i) => {
          const Icon = BRIEF_ICON_MAP[point.icon] ?? BRIEF_ICON_MAP[fallbackIcon];
          return (
            <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug text-ink-secondary">
              <span
                className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border"
                style={{
                  color,
                  borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
                  background: `color-mix(in srgb, ${color} 12%, transparent)`,
                }}
              >
                <Icon className="h-3 w-3" />
              </span>
              <span className="min-w-0 flex-1">{point.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
