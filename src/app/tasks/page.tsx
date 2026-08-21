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
} from "lucide-react";
import { apiFetch } from "@/lib/api";
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

  if (task.resultUrl) enlaces.push({ url: task.resultUrl, label: etiquetaDelComentario(task.resultUrl) });
  if (task.resultProfileUrl) enlaces.push({ url: task.resultProfileUrl, label: "Perfil" });
  if (enlaces.length) return enlaces;

  const goto = task.steps?.find((s) => s.action === "goto" && s.url)?.url;
  return goto ? [{ url: goto, label: "Ver publicación" }] : [];
}

type Profile = { _id: string; name: string };

const PAGE_SIZE = 20;
const STATUSES = ["pending", "queued", "running", "paused", "success", "failed", "cancelled"];
const TYPES = ["login", "post", "warmup", "scrape", "like", "likecomment", "comment", "custom"];

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse-soft rounded-2xl bg-surface" />}>
      <TasksContent />
    </Suspense>
  );
}

function TasksContent() {
  const searchParams = useSearchParams();
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <FolderKanban className="h-4 w-4" /> Ver campañas
          </Link>
          <Link
            href="/tasks/like"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <Heart className="h-4 w-4" /> Campaña de likes
          </Link>
          <Link
            href="/tasks/likecomment"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <MessageCircleHeart className="h-4 w-4" /> Likes a comentarios
          </Link>
          <Link
            href="/tasks/comment"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <MessageSquare className="h-4 w-4" /> Campaña de comentarios
          </Link>
          <Link
            href="/tasks/ramificacion"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <GitBranch className="h-4 w-4" /> Ramificaciones
          </Link>
          <Link
            href="/tasks/post"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <Megaphone className="h-4 w-4" /> Campaña de publicaciones
          </Link>
          <Link
            href="/tasks/warmup"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-ink hover:shadow-md"
          >
            <Activity className="h-4 w-4" /> Campaña de warmup
          </Link>
          <Link
            href="/tasks/new"
            className="glow-btn inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <Plus className="h-4 w-4" /> Nueva tarea
          </Link>
          <button
            type="button"
            disabled={stopping}
            onClick={stopCampaigns}
            className="glow-btn-critical inline-flex items-center gap-1.5 rounded-lg bg-critical px-3 py-2 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
          >
            <OctagonX className="h-4 w-4" /> {stopping ? "Deteniendo..." : "Parar campañas"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

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

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
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
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">Cargando...</td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">Sin tareas que coincidan.</td>
                </tr>
              ) : (
                tasks.map((t) => {
                  const enlaces = enlacesDeLaTarea(t);
                  return (
                  <tr key={t._id} className="border-t border-hairline transition-colors hover:bg-page/60">
                    <td className="px-4 py-3 font-medium text-ink">
                      <Link href={`/tasks/${t._id}`} className="hover:text-primary hover:underline">
                        {t.name}
                      </Link>
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
                        <button
                          disabled={busyId === t._id || t.status === "running" || t.status === "queued"}
                          onClick={() => runTask(t._id)}
                          className="rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium transition-colors hover:bg-page disabled:opacity-40"
                        >
                          Ejecutar
                        </button>
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
