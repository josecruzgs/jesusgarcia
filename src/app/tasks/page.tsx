"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Heart,
  MessageCircleHeart,
  MessageSquare,
  Megaphone,
  Activity,
  Plus,
  Search,
  OctagonX,
  FolderKanban,
  ExternalLink,
  GitBranch,
  UsersRound,
  UserPlus,
  RotateCcw,
  Newspaper,
  Ban,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";
import { esRelanzamientoDeLike } from "@/lib/tasks/relanzar";
import StatusBadge from "@/components/StatusBadge";
import Pagination from "@/components/Pagination";
import Card from "@/components/Card";

type Task = {
  _id: string;
  name: string;
  type: string;
  status: string;
  profileId: { _id: string; name: string } | null;
  scheduledAt: string;
  createdAt: string;
  steps?: { action: string; url?: string }[];
  resultUrl?: string;
  resultProfileUrl?: string;
  /** Usuario que la creó. Solo llega para el admin. */
  ownerName?: string;
};

/**
 * Cómo se llama el enlace al comentario, según dónde caiga.
 *
 * En una publicación normal el `?comment_id=` funciona y el navegador queda
 * parado en el comentario. En el visor de Reels no: Facebook descarta el
 * parámetro al cargar y deja al usuario en el reel, a buscarlo a mano en el
 * panel. El enlace es el mismo que genera Facebook —no hay forma de mejorarlo
 * por URL—, así que lo que se ajusta es la promesa del rótulo.
 */
function etiquetaDelComentario(url: string) {
  return /\/reel\//.test(url) ? "Ver en el reel" : "Ver comentario";
}

/**
 * Los enlaces externos de una tarea, en orden de utilidad.
 *
 * Son hasta tres destinos distintos y cada uno responde una pregunta: el
 * comentario publicado, la cuenta que lo puso ("Perfil") y el posteo ("Ver
 * publicación") — este último solo cuando no hay nada más preciso (tareas de
 * like, o comentarios anteriores a que se capturaran los otros dos).
 *
 * Devuelve una lista vacía en las tareas que no navegan a ningún lado (una
 * hecha a mano, por ejemplo); ahí no se dibuja ningún enlace muerto.
 */
function enlacesDeLaTarea(task: Task): { url: string; label: string }[] {
  const enlaces: { url: string; label: string }[] = [];

  if (task.resultUrl) {
    const label = task.type === "grouppost" ? "Ver publicación" : etiquetaDelComentario(task.resultUrl);
    enlaces.push({ url: task.resultUrl, label });
  }
  if (task.resultProfileUrl) enlaces.push({ url: task.resultProfileUrl, label: "Perfil" });
  if (enlaces.length) return enlaces;

  const goto = task.steps?.find((s) => s.action === "goto" && s.url)?.url;
  return goto ? [{ url: goto, label: "Ver publicación" }] : [];
}

type Profile = { _id: string; name: string };

const PAGE_SIZE = 20;
const STATUSES = ["pending", "queued", "running", "paused", "success", "failed", "cancelled"];
const TYPES = ["login", "post", "warmup", "scrape", "like", "likecomment", "comment", "joingroup", "grouppost", "follow", "custom"];

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse-soft rounded-lg bg-surface" />}>
      <TasksContent />
    </Suspense>
  );
}

function TasksContent() {
  const searchParams = useSearchParams();
  const esAdmin = useSession()?.role === "admin";
  const initialStatus = searchParams.get("status") ?? "";
  const initialType = searchParams.get("type") ?? "";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  // Selección para las acciones masivas. `todas` es "todas las que coinciden
  // con los filtros", no solo las de esta página: ahí no se mandan ids sino
  // los filtros, y el servidor resuelve el mismo conjunto que está contando.
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [todas, setTodas] = useState(false);
  const [masivaEnCurso, setMasivaEnCurso] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Esta instalación no tiene rol de solo lectura: todos pueden editar.
  const puedeEditar = true;

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState(initialType);
  const [profileId, setProfileId] = useState("");

  useEffect(() => {
    apiFetch<{ profiles: Profile[] }>("/api/profiles?all=true")
      .then(({ profiles }) => setProfiles(profiles))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Cambiar un filtro cambia qué es "lo seleccionado": se arranca de cero en
  // vez de arrastrar casillas de tareas que ya no están en la tabla.
  useEffect(() => {
    setSeleccion(new Set());
    setTodas(false);
  }, [status, type, profileId, search]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      if (profileId) params.set("profileId", profileId);
      if (search) params.set("search", search);
      const data = await apiFetch<{ tasks: Task[]; total: number }>(`/api/tasks?${params}`);
      setTasks(data.tasks);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, type, profileId, search]);

  function updateStatus(v: string) {
    setStatus(v);
    setPage(1);
  }
  function updateType(v: string) {
    setType(v);
    setPage(1);
  }
  function updateProfileId(v: string) {
    setProfileId(v);
    setPage(1);
  }
  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setStatus("");
    setType("");
    setProfileId("");
    setPage(1);
  }

  async function runTask(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/api/tasks/${id}/run`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTask(id: string) {
    if (!confirm("¿Eliminar esta tarea?")) return;
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function stopCampaigns() {
    if (!confirm("¿Parar campañas? Se eliminan todas las tareas 'pending' y 'queued' (las que aún no arrancaron). Las que ya están corriendo terminan solas.")) return;
    setStopping(true);
    setError(null);
    try {
      const { deletedCount } = await apiFetch<{ deletedCount: number }>("/api/tasks/stop-campaigns", { method: "POST" });
      await load();
      alert(`Se eliminaron ${deletedCount} tarea${deletedCount === 1 ? "" : "s"} en cola.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  }

  const idsDePagina = tasks.map((t) => t._id);
  const paginaEntera = idsDePagina.length > 0 && idsDePagina.every((id) => seleccion.has(id));
  const paginaParcial = !paginaEntera && idsDePagina.some((id) => seleccion.has(id));
  const cantidadSeleccionada = todas ? total : seleccion.size;

  function alternar(id: string) {
    setTodas(false);
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function alternarPagina() {
    setTodas(false);
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (paginaEntera) idsDePagina.forEach((id) => next.delete(id));
      else idsDePagina.forEach((id) => next.add(id));
      return next;
    });
  }

  function limpiarSeleccion() {
    setSeleccion(new Set());
    setTodas(false);
  }

  const ACCIONES_MASIVAS = {
    run: { verbo: "relanzar", hecho: "relanzaron", saltoPorque: "ya estaban en cola o corriendo" },
    cancel: { verbo: "cancelar", hecho: "cancelaron", saltoPorque: "ya habían arrancado o terminado" },
    delete: { verbo: "eliminar", hecho: "eliminaron", saltoPorque: "están corriendo" },
  } as const;

  async function accionMasiva(action: keyof typeof ACCIONES_MASIVAS) {
    const { verbo, hecho, saltoPorque } = ACCIONES_MASIVAS[action];
    const n = cantidadSeleccionada;
    const cuales = todas ? `las ${n} tareas que coinciden con los filtros` : `${n} tarea${n === 1 ? "" : "s"} seleccionada${n === 1 ? "" : "s"}`;
    const extra = action === "delete" ? " Se borran también sus logs y no se puede deshacer." : "";
    if (!confirm(`¿${verbo[0].toUpperCase()}${verbo.slice(1)} ${cuales}?${extra}`)) return;

    setMasivaEnCurso(true);
    setError(null);
    setAviso(null);
    try {
      const body = todas
        ? { action, filters: { status, type, profileId, search } }
        : { action, ids: Array.from(seleccion) };
      const { afectadas, saltadas } = await apiFetch<{ afectadas: number; saltadas: number }>("/api/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setAviso(
        `Se ${hecho} ${afectadas} tarea${afectadas === 1 ? "" : "s"}.` +
          (saltadas ? ` ${saltadas} se saltaron porque ${saltoPorque}${action === "run" && !esAdmin ? " (o son likes exitosos, que solo relanza un admin)" : ""}.` : ""),
      );
      limpiarSeleccion();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMasivaEnCurso(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(status || type || profileId || search);

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Tareas</h1>
          <p className="mt-1 text-sm text-ink-secondary">{total} en total</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/campanas"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <FolderKanban className="h-4 w-4" /> Ver campañas
          </Link>
          <Link
            href="/tasks/like"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <Heart className="h-4 w-4" /> Campaña de likes
          </Link>
          <Link
            href="/tasks/likecomment"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <MessageCircleHeart className="h-4 w-4" /> Likes a comentarios
          </Link>
          <Link
            href="/tasks/comment"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <MessageSquare className="h-4 w-4" /> Campaña de comentarios
          </Link>
          <Link
            href="/tasks/ramificacion"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <GitBranch className="h-4 w-4" /> Ramificaciones
          </Link>
          <Link
            href="/tasks/unirse-grupo"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <UsersRound className="h-4 w-4" /> Unirse a grupos
          </Link>
          <Link
            href="/tasks/publicar-grupo"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <Newspaper className="h-4 w-4" /> Publicar en grupos
          </Link>
          <Link
            href="/tasks/follow"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <UserPlus className="h-4 w-4" /> Seguir perfiles
          </Link>
          <Link
            href="/tasks/post"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <Megaphone className="h-4 w-4" /> Campaña de publicaciones
          </Link>
          <Link
            href="/tasks/warmup"
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-100 hover:text-ink"
          >
            <Activity className="h-4 w-4" /> Campaña de warmup
          </Link>
          <Link
            href="/tasks/new"
            className="glow-btn inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-fg transition-colors duration-100"
          >
            <Plus className="h-4 w-4" /> Nueva tarea
          </Link>
          <button
            type="button"
            disabled={stopping}
            onClick={stopCampaigns}
            className="glow-btn-critical inline-flex items-center gap-1.5 rounded bg-critical px-3 py-2 text-sm font-medium text-white transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50"
          >
            <OctagonX className="h-4 w-4" /> {stopping ? "Deteniendo..." : "Parar campañas"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-50 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre..."
            className="w-full rounded-lg border border-hairline bg-page py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <select
          value={status}
          onChange={(e) => updateStatus(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => updateType(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los tipos</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={profileId}
          onChange={(e) => updateProfileId(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los perfiles</option>
          {profiles.map((p) => (
            <option key={p._id} value={p._id}>{p.name}</option>
          ))}
        </select>
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs text-ink-muted underline hover:text-ink">
            Limpiar filtros
          </button>
        )}
      </Card>

      {aviso && (
        <p className="flex items-start justify-between gap-3 rounded-xl bg-primary/10 p-3 text-sm text-ink">
          {aviso}
          <button type="button" onClick={() => setAviso(null)} className="text-xs text-ink-muted underline hover:text-ink">
            Cerrar
          </button>
        </p>
      )}

      {puedeEditar && cantidadSeleccionada > 0 && (
        <Card className="sticky top-2 z-10 flex flex-wrap items-center gap-2 border-primary/40 p-3 shadow-md">
          <span className="text-sm font-medium text-ink">
            {todas
              ? `Las ${total} tareas que coinciden con los filtros`
              : `${cantidadSeleccionada} seleccionada${cantidadSeleccionada === 1 ? "" : "s"}`}
          </span>
          {/* Con la página entera marcada y más páginas detrás, se ofrece
              ampliar a todas las que coinciden: es el caso de "borrar las 300
              fallidas" sin tener que ir página por página. */}
          {!todas && paginaEntera && total > tasks.length && (
            <button
              type="button"
              onClick={() => setTodas(true)}
              className="text-xs font-medium text-primary underline hover:no-underline"
            >
              Seleccionar las {total} que coinciden con los filtros
            </button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              disabled={masivaEnCurso}
              onClick={() => accionMasiva("run")}
              className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium transition-colors hover:bg-page disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" /> Relanzar
            </button>
            <button
              type="button"
              disabled={masivaEnCurso}
              onClick={() => accionMasiva("cancel")}
              className="inline-flex items-center gap-1 rounded-lg border border-warning/30 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/10 disabled:opacity-40"
            >
              <Ban className="h-3 w-3" /> Cancelar
            </button>
            <button
              type="button"
              disabled={masivaEnCurso}
              onClick={() => accionMasiva("delete")}
              className="inline-flex items-center gap-1 rounded-lg border border-critical/20 px-2.5 py-1 text-xs font-medium text-critical transition-colors hover:bg-critical/10 disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" /> Eliminar
            </button>
            <button
              type="button"
              disabled={masivaEnCurso}
              onClick={limpiarSeleccion}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              Quitar selección
            </button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                {puedeEditar && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todas las de esta página"
                      checked={todas || paginaEntera}
                      ref={(el) => {
                        if (el) el.indeterminate = !todas && paginaParcial;
                      }}
                      onChange={() => (todas ? limpiarSeleccion() : alternarPagina())}
                      disabled={!tasks.length}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </th>
                )}
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Perfil</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Programada</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && tasks.length === 0 ? (
                <tr>
                  <td colSpan={6 + (puedeEditar ? 1 : 0)} className="px-4 py-10 text-center text-ink-muted">Cargando...</td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={6 + (puedeEditar ? 1 : 0)} className="px-4 py-10 text-center text-ink-muted">Sin tareas que coincidan.</td>
                </tr>
              ) : (
                tasks.map((t) => {
                  const enlaces = enlacesDeLaTarea(t);
                  return (
                  <tr
                    key={t._id}
                    className={`border-t border-hairline transition-colors hover:bg-page/60 ${
                      todas || seleccion.has(t._id) ? "bg-primary/5" : ""
                    }`}
                  >
                    {puedeEditar && (
                      <td className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${t.name}`}
                          checked={todas || seleccion.has(t._id)}
                          onChange={() => {
                            // Desmarcar una fila con "todas" activo baja a la
                            // selección explícita de esta página menos esa.
                            if (todas) {
                              setTodas(false);
                              setSeleccion(new Set(idsDePagina.filter((id) => id !== t._id)));
                            } else alternar(t._id);
                          }}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium text-ink">
                      <Link href={`/tasks/${t._id}`} className="hover:text-primary hover:underline">
                        {t.name}
                      </Link>
                      {t.ownerName && <p className="label-mono-sm mt-0.5 font-normal normal-case">@{t.ownerName}</p>}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{t.profileId?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-secondary">{t.type}</td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-3 text-ink-secondary">{new Date(t.scheduledAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {enlaces.map((enlace) => (
                          // rel="noreferrer" además de noopener: es un sitio
                          // externo y no tiene por qué saber de dónde viene.
                          <a
                            key={enlace.label}
                            href={enlace.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={enlace.url}
                            className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium transition-colors hover:bg-page"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {enlace.label}
                          </a>
                        ))}
                        {esRelanzamientoDeLike(t) ? (
                          // Like exitoso: relanzarlo es para revisar un falso
                          // positivo y solo lo hace un admin (la API lo exige).
                          esAdmin && (
                            <button
                              disabled={busyId === t._id}
                              onClick={() => runTask(t._id)}
                              title="Volver a dar el like si la tarea fue un falso positivo"
                              className="inline-flex items-center gap-1 rounded-lg border border-warning/30 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/10 disabled:opacity-40"
                            >
                              <RotateCcw className="h-3 w-3" /> Relanzar
                            </button>
                          )
                        ) : (
                          <button
                            disabled={busyId === t._id || t.status === "running" || t.status === "queued"}
                            onClick={() => runTask(t._id)}
                            className="rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium transition-colors hover:bg-page disabled:opacity-40"
                          >
                            Ejecutar
                          </button>
                        )}
                        <button
                          disabled={busyId === t._id}
                          onClick={() => deleteTask(t._id)}
                          className="rounded-lg border border-critical/20 px-2.5 py-1 text-xs font-medium text-critical transition-colors hover:bg-critical/10 disabled:opacity-40"
                        >
                          Eliminar
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
    </div>
  );
}
