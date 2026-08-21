"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles, Megaphone, Footprints, PenLine } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Modal from "@/components/Modal";
import PageHeader from "@/components/ui/PageHeader";
import ProfilePicker, { type PickerGroup, type PickerProfile } from "@/components/ProfilePicker";
import PlayCard, { type ActionPlayRow } from "@/components/listening/PlayCard";
import IdeaCard, { type ImageIdeaRow } from "@/components/listening/IdeaCard";

type Project = { _id: string; name: string; entities: { name: string }[] };

const TABS = [
  { key: "suggested", label: "Propuestas" },
  { key: "approved", label: "Aprobadas" },
  { key: "dispatched", label: "Ejecutadas" },
  { key: "discarded", label: "Descartadas" },
] as const;

const inputClass =
  "rounded-[9px] border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary";

export default function PublicacionesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [project, setProject] = useState<Project | null>(null);
  const [plays, setPlays] = useState<ActionPlayRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<string>("suggested");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Las ideas van por su cuenta: no cuelgan de una publicación, no se filtran
  // por pestaña y generarlas es otra llamada. Compartir el estado con las
  // jugadas obligaría a recargarlas juntas sin motivo.
  const [ideas, setIdeas] = useState<ImageIdeaRow[]>([]);
  const [ideasBusy, setIdeasBusy] = useState(false);

  // Se cargan una vez y se comparten entre todos los despachos: son cientos de
  // perfiles y volver a pedirlos cada vez que se abre el diálogo haría esperar
  // sin motivo.
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const [dispatching, setDispatching] = useState<ActionPlayRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [staggerSeconds, setStaggerSeconds] = useState(300);
  const [autoRun, setAutoRun] = useState(true);

  const load = useCallback(async () => {
    try {
      const [projectData, playsData] = await Promise.all([
        apiFetch<{ project: Project }>(`/api/listening/projects/${id}`),
        apiFetch<{ plays: ActionPlayRow[]; counts: Record<string, number> }>(
          `/api/listening/projects/${id}/plays?status=${tab}`,
        ),
      ]);
      setProject(projectData.project);
      setPlays(playsData.plays);
      setCounts(playsData.counts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id, tab]);

  const loadIdeas = useCallback(async () => {
    try {
      const data = await apiFetch<{ ideas: ImageIdeaRow[] }>(
        `/api/listening/projects/${id}/ideas`,
      );
      setIdeas(data.ideas);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadIdeas();
  }, [loadIdeas]);

  useEffect(() => {
    Promise.all([
      apiFetch<{ profiles: PickerProfile[] }>("/api/profiles?all=true"),
      apiFetch<{ groups: PickerGroup[] }>("/api/groups?all=true"),
    ])
      .then(([p, g]) => {
        setProfiles(p.profiles);
        setGroups(g.groups);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setProfilesLoading(false));
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ plays: ActionPlayRow[] }>(
        `/api/listening/projects/${id}/plays`,
        { method: "POST", body: JSON.stringify({ count: 10 }) },
      );
      setNotice(`${res.plays.length} jugadas propuestas.`);
      setTab("suggested");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function generateIdeas() {
    setIdeasBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ ideas: ImageIdeaRow[] }>(
        `/api/listening/projects/${id}/ideas`,
        { method: "POST", body: JSON.stringify({ count: 10 }) },
      );
      setNotice(`${res.ideas.length} ideas nuevas.`);
      await loadIdeas();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIdeasBusy(false);
    }
  }

  async function patchIdea(ideaId: string, patch: Record<string, unknown>) {
    setIdeasBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/listening/projects/${id}/ideas/${ideaId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadIdeas();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIdeasBusy(false);
    }
  }

  async function removeIdea(ideaId: string) {
    if (!confirm("¿Borrar esta idea?")) return;
    setIdeasBusy(true);
    try {
      await apiFetch(`/api/listening/projects/${id}/ideas/${ideaId}`, { method: "DELETE" });
      await loadIdeas();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIdeasBusy(false);
    }
  }

  async function patchPlay(playId: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/listening/projects/${id}/plays/${playId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removePlay(playId: string) {
    if (!confirm("¿Borrar esta jugada?")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/listening/projects/${id}/plays/${playId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openDispatch(play: ActionPlayRow) {
    setDispatching(play);
    setSelected(new Set());
  }

  async function confirmDispatch() {
    if (!dispatching) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ campaign: { name: string; taskCount: number } }>(
        `/api/listening/projects/${id}/plays/${dispatching._id}/dispatch`,
        {
          method: "POST",
          body: JSON.stringify({
            profileIds: Array.from(selected),
            staggerSeconds,
            autoRun,
          }),
        },
      );
      setNotice(
        `Campaña "${res.campaign.name}" creada con ${res.campaign.taskCount} tarea(s).` +
          (autoRun ? " El worker las va a tomar de la cola." : " Quedaron en pausa, actívalas desde Campañas."),
      );
      setDispatching(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Una columna cada uno. El filtro va acá y no en dos consultas separadas
  // porque el lote se genera de una sola vez: pedirlo dos veces sería el mismo
  // documento partido en dos viajes.
  const acciones = ideas.filter((idea) => idea.kind === "accion");
  const publicaciones = ideas.filter((idea) => idea.kind === "publicacion");

  const suggestedCount = dispatching?.suggestedCount ?? 0;
  // En una jugada de comentario hay un texto por cuenta, así que elegir más
  // perfiles que textos obligaría a repetir un comentario en la misma
  // publicación: se bloquea acá y el servidor lo vuelve a rechazar.
  const tooManyForTexts =
    dispatching?.kind === "comment" && selected.size > dispatching.comments.length;

  return (
    <div className="flex animate-fade-in-up flex-col gap-5">
      <Link
        href={`/scrapping/proyecto/${id}`}
        className="label-mono-sm inline-flex w-fit items-center gap-1.5 transition-colors hover:text-gold"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {project?.name ?? "Proyecto"}
      </Link>

      {/* El botón de generar ya no vive acá: son dos generaciones distintas,
          una por columna, y un botón solo en la cabecera no deja ver cuál de
          las dos rehace. Cada columna trae el suyo. */}
      <PageHeader
        title="Publicaciones +"
        subtitle="Qué hacer sobre lo que la escucha encontró, para mover el sentimiento hacia la figura"
        icon={<Megaphone className="h-4.5 w-4.5" />}
      />

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

      {/* Dos columnas desde lg, y `items-start` para que la columna corta no
          se estire a la altura de la larga.

          El corte es por quién ejecuta: a la izquierda lo que hace la figura
          por cuenta propia —primero las acciones de terreno, después las
          publicaciones nuevas— y a la derecha lo que hacen los perfiles sobre
          publicaciones que ya existen. Abajo de lg se apila en ese mismo
          orden, que es el de importancia. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* --- Columna izquierda: ideas de imagen --- */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="overline">Ideas para mover la imagen</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
                Del análisis del último mes: qué hacer en el terreno y qué publicar. Generar de
                nuevo reemplaza el lote, salvo lo que hayas guardado con el marcador.
              </p>
            </div>
            <button
              onClick={generateIdeas}
              disabled={ideasBusy}
              className="tbtn inline-flex shrink-0 items-center gap-1.5"
            >
              <Sparkles className={`h-3.5 w-3.5 ${ideasBusy ? "animate-pulse" : ""}`} />
              {ideasBusy ? "Pensando..." : ideas.length > 0 ? "Generar otras" : "Generar ideas"}
            </button>
          </div>

          {ideas.length === 0 ? (
            <div className="card-surface px-6 py-10 text-center">
              <p className="text-[13px] leading-relaxed text-ink-secondary">
                Todavía no hay ideas. “Generar ideas” lee las menciones del último mes y el resumen
                ejecutivo vigente, y propone diez acciones de terreno —que no se resuelven
                publicando— y diez publicaciones nuevas, cada una con su borrador.
              </p>
            </div>
          ) : (
            <>
              <section className="flex flex-col gap-3">
                <h3 className="label-mono flex items-center gap-1.5">
                  <Footprints className="h-3.5 w-3.5" style={{ color: "var(--el-tierra)" }} />
                  Acciones · qué hacer ({acciones.length})
                </h3>
                {acciones.length === 0 ? (
                  <p className="label-mono-sm normal-case tracking-normal">
                    El último lote no propuso acciones.
                  </p>
                ) : (
                  acciones.map((idea) => (
                    <IdeaCard
                      key={idea._id}
                      idea={idea}
                      busy={ideasBusy}
                      onKeep={(kept) => patchIdea(idea._id, { kept })}
                      onDelete={() => removeIdea(idea._id)}
                    />
                  ))
                )}
              </section>

              <section className="flex flex-col gap-3">
                <h3 className="label-mono flex items-center gap-1.5">
                  <PenLine className="h-3.5 w-3.5" style={{ color: "var(--el-viento)" }} />
                  Publicaciones · qué subir ({publicaciones.length})
                </h3>
                {publicaciones.length === 0 ? (
                  <p className="label-mono-sm normal-case tracking-normal">
                    El último lote no propuso publicaciones.
                  </p>
                ) : (
                  publicaciones.map((idea) => (
                    <IdeaCard
                      key={idea._id}
                      idea={idea}
                      busy={ideasBusy}
                      onKeep={(kept) => patchIdea(idea._id, { kept })}
                      onDelete={() => removeIdea(idea._id)}
                    />
                  ))
                )}
              </section>
            </>
          )}
        </div>

        {/* --- Columna derecha: jugadas sobre publicaciones que ya existen --- */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="overline">Publicaciones a intensificar</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
                Diez jugadas de likes y comentarios sobre publicaciones que la escucha ya encontró.
                Cada una se activa como campaña con los perfiles que elijas.
              </p>
            </div>
            <button
              onClick={generate}
              disabled={busy}
              className="tbtn inline-flex shrink-0 items-center gap-1.5"
            >
              <Sparkles className={`h-3.5 w-3.5 ${busy ? "animate-pulse" : ""}`} />
              {busy ? "Analizando..." : "Generar jugadas"}
            </button>
          </div>

          <div className="card-surface flex flex-wrap items-center gap-2 px-4 py-3">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-[7px] border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  tab === t.key ? "accent-fill" : "border-hairline text-ink-secondary hover:text-ink"
                }`}
              >
                {t.label} {counts[t.key] ? `(${counts[t.key]})` : ""}
              </button>
            ))}
          </div>

          {plays.length === 0 ? (
            <div className="card-surface px-6 py-10 text-center">
              <p className="text-[13px] leading-relaxed text-ink-secondary">
                {tab === "suggested"
                  ? "Sin jugadas propuestas. “Generar jugadas” lee las publicaciones de redes del último mes y el resumen ejecutivo vigente, y propone dónde conviene comentar para defender y dónde mandar reacciones para amplificar. Necesita menciones de Facebook, Instagram, TikTok o X: en una nota de prensa no hay nada que comentar ni likear."
                  : "Nada por acá todavía."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {plays.map((play) => (
                <PlayCard
                  key={play._id}
                  play={play}
                  busy={busy}
                  onSave={(patch) => patchPlay(play._id, patch)}
                  onStatus={(status) => patchPlay(play._id, { status })}
                  onDispatch={() => openDispatch(play)}
                  onDelete={() => removePlay(play._id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={dispatching !== null}
        onClose={() => setDispatching(null)}
        size="xl"
        title="Activar la campaña"
      >
        {dispatching && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              {dispatching.headline}
            </p>
            <p className="label-mono-sm normal-case tracking-normal">
              {dispatching.kind === "comment"
                ? `${dispatching.comments.length} textos distintos · máximo ${dispatching.comments.length} cuentas, una por texto`
                : `Recomendado: ${suggestedCount} cuenta${suggestedCount === 1 ? "" : "s"}`}
            </p>

            {tooManyForTexts && (
              <p className="rounded-[9px] border border-critical/40 bg-critical/10 p-3 text-[12.5px] text-critical">
                Elegiste {selected.size} cuentas y hay {dispatching.comments.length} textos. Dos
                cuentas tendrían que publicar el mismo comentario en la misma publicación. Quitá
                cuentas, o cerrá y agregá más textos con “Editar”.
              </p>
            )}

            {!tooManyForTexts && dispatching.kind === "like" && selected.size > suggestedCount && (
              <p className="rounded-[9px] border border-amber/40 bg-amber/10 p-3 text-[12.5px] text-amber">
                Elegiste {selected.size} cuentas y la recomendación era {suggestedCount}. Más volumen
                del necesario en un mismo post es lo que hace que se lea como operación.
              </p>
            )}

            <ProfilePicker
              profiles={profiles}
              groups={groups}
              loading={profilesLoading}
              selected={selected}
              onChange={setSelected}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="label-mono">Segundos entre cuentas</span>
                <input
                  type="number"
                  min={0}
                  value={staggerSeconds}
                  onChange={(e) => setStaggerSeconds(Math.max(0, Number(e.target.value) || 0))}
                  className={inputClass}
                />
                <span className="text-[11px] leading-snug text-ink-muted">
                  Escalona la ejecución. Todas juntas en el mismo minuto sobre la misma publicación
                  es el patrón que las plataformas marcan.
                </span>
              </label>
              <label className="card-flat flex cursor-pointer items-center gap-3 self-start p-3">
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  className="accent-primary"
                />
                <div>
                  <p className="text-[13px] font-medium text-ink">Encolar de una vez</p>
                  <p className="label-mono-sm mt-0.5 normal-case tracking-normal">
                    Sin esto las tareas quedan en pausa esperando en Campañas
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2 border-t border-hairline pt-4">
          <button onClick={() => setDispatching(null)} className="tbtn">
            Cancelar
          </button>
          <button
            onClick={confirmDispatch}
            disabled={busy || selected.size === 0 || tooManyForTexts}
            className="rounded-[9px] bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
          >
            Activar con {selected.size} cuenta{selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
