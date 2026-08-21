"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageCircleHeart, CheckCircle2, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { parseFacebookCommentTarget } from "@/lib/commentLinks";
// El picker de reacciones de un comentario es el mismo que el de una
// publicación (se abre en una capa flotante al mantener el cursor sobre "Me
// gusta"), así que comparte los selectores con /tasks/like.
import { REACTIONS, reactionSelectorFor } from "@/lib/automation/socialSelectors";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import Modal from "@/components/Modal";
import ProfilePicker, { type PickerGroup, type PickerProfile } from "@/components/ProfilePicker";
import ExistingCampaignPicker from "@/components/ExistingCampaignPicker";

type CreatedTask = {
  _id: string;
  name: string;
  status: string;
  profile: { _id: string; name: string };
};

type CreatedCampaign = {
  _id: string;
  name: string;
  status: string;
  taskCount: number;
};

export default function LikeCommentCampaignPage() {
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [reaction, setReaction] = useState("like");
  const [waitMs, setWaitMs] = useState(4000);
  const [staggerSeconds, setStaggerSeconds] = useState(300);
  const [autoRun, setAutoRun] = useState(true);
  const [namePrefix, setNamePrefix] = useState("like-comentario");
  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState<"new" | "existing">("new");
  const [existingCampaignId, setExistingCampaignId] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreatedTask[] | null>(null);
  const [createdCampaign, setCreatedCampaign] = useState<CreatedCampaign | null>(null);

  // El mismo parser que usa la API: así el aviso de "este link no trae
  // comment_id" sale antes de mandar nada, no como error del servidor.
  const target = useMemo(() => (url.trim() ? parseFacebookCommentTarget(url) : null), [url]);

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
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const cid = new URLSearchParams(window.location.search).get("campaignId");
    if (cid) {
      setCampaignMode("existing");
      setExistingCampaignId(cid);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);
    setCreatedCampaign(null);
    try {
      const { campaign, tasks } = await apiFetch<{ campaign: CreatedCampaign; tasks: CreatedTask[] }>(
        "/api/tasks/like-comment-campaign",
        {
          method: "POST",
          body: JSON.stringify({
            campaignName: campaignMode === "new" ? campaignName : undefined,
            campaignId: campaignMode === "existing" ? existingCampaignId : undefined,
            url,
            reaction,
            reactionSelector: reactionSelectorFor(reaction),
            profileIds: Array.from(selected),
            waitMs,
            staggerSeconds,
            autoRun,
            namePrefix,
          }),
        },
      );
      setResult(tasks);
      setCreatedCampaign(campaign);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const count = selected.size;

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <Link href="/tasks" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Tareas
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-series-3/55 bg-series-3/12 text-series-3">
            <MessageCircleHeart className="h-4.5 w-4.5" />
          </span>
          <h1 className="text-2xl font-semibold text-ink">Campaña de likes a comentarios</h1>
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Igual que la campaña de likes, pero la reacción cae en un comentario concreto de la publicación —
          se identifica por el <code className="rounded bg-page px-1 py-0.5 text-xs">comment_id</code> del link.
        </p>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      {result && (
        <Card className="flex animate-fade-in-up flex-col gap-3 border-success/20 bg-success/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            {createdCampaign ? (
              <>
                {campaignMode === "existing" ? "Se agregaron tareas a la campaña" : "Se creó la campaña"}{" "}
                <Link href={`/campanas?campaignId=${createdCampaign._id}`} className="underline">
                  {createdCampaign.name}
                </Link>{" "}
                ({result.length} nueva{result.length === 1 ? "" : "s"}).
              </>
            ) : (
              <>Se crearon {result.length} tarea{result.length === 1 ? "" : "s"}.</>
            )}
          </p>
          <div className="flex flex-col gap-1.5">
            {result.map((t) => (
              <div key={t._id} className="flex items-center justify-between gap-2">
                <Link href={`/tasks/${t._id}`} className="text-ink hover:text-primary hover:underline">
                  {t.profile.name}
                </Link>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            {createdCampaign && (
              <Link href={`/campanas?campaignId=${createdCampaign._id}`} className="w-fit text-primary underline">
                Abrir campaña →
              </Link>
            )}
            <Link href="/tasks" className="w-fit text-primary underline">Ver todas las tareas →</Link>
          </div>
        </Card>
      )}

      <form onSubmit={submit} className="card-surface flex flex-col gap-5 p-5">
        <ExistingCampaignPicker
          type="likecomment"
          mode={campaignMode}
          onModeChange={setCampaignMode}
          campaignId={existingCampaignId}
          onCampaignIdChange={setExistingCampaignId}
        />

        {campaignMode === "new" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Nombre de campaña</label>
            <input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Ej. Apoyo al comentario"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Link del comentario</label>
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.facebook.com/permalink.php?story_fbid=...&id=...&comment_id=..."
            className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
          {url.trim() && !target && (
            <p className="flex items-start gap-1.5 text-xs text-critical">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Este link no trae <code>comment_id</code>: apunta a la publicación, no a un comentario. Copia el
              link desde la hora del comentario (o su menú ··· → Copiar enlace).
            </p>
          )}
          {target && (
            <p className="text-xs text-success">
              {target.isReply ? "Respuesta" : "Comentario"} detectado: <code>{target.commentId}</code>
            </p>
          )}
          <p className="text-xs text-ink-muted">
            Solo Facebook por ahora. En X/Twitter una respuesta es una publicación con su propio link, así que
            para ésas sirve la{" "}
            <Link href="/tasks/like" className="underline hover:text-ink">campaña de likes normal</Link>.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Reacción</label>
          <select
            value={reaction}
            onChange={(e) => setReaction(e.target.value)}
            className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          >
            {REACTIONS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          {reaction !== "like" && (
            <p className="text-xs text-ink-muted">
              La tarea mantiene el cursor sobre el &quot;Me gusta&quot; del comentario para que Facebook revele el
              picker de reacciones, y ahí elige ésta.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Espaciado entre tareas (minutos)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={staggerSeconds / 60}
              onChange={(e) => setStaggerSeconds(Math.max(0, Math.round(Number(e.target.value) * 60)))}
              className="w-40 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-page hover:text-ink"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Ver ajustes adicionales
          </button>
        </div>

        <label className="flex w-fit items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} className="h-4 w-4 accent-primary" />
          Encolar y ejecutar automáticamente al crear
        </label>
        {!autoRun && (
          <p className="-mt-3 text-xs text-ink-muted">
            Las tareas quedan en &quot;pending&quot;; las ejecutas manualmente desde Tareas.
          </p>
        )}

        <div className="border-t border-hairline pt-4">
          <ProfilePicker profiles={profiles} groups={groups} loading={loading} selected={selected} onChange={setSelected} />
        </div>

        <button
          disabled={creating || count === 0 || !target || (campaignMode === "existing" && !existingCampaignId)}
          className="glow-btn w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
        >
          {creating
            ? "Creando..."
            : campaignMode === "existing"
              ? `Agregar tareas de like a comentario (${count || 0})`
              : `Crear campaña de like a comentario (${count || 0})`}
        </button>
      </form>

      <Modal open={showAdvanced} onClose={() => setShowAdvanced(false)} title="Ajustes adicionales">
        <div className="flex flex-col gap-4">
          <p className="text-xs text-ink-muted">
            Esta campaña no lleva selector CSS: el botón de un comentario es idéntico al de la publicación y al de
            los demás comentarios, así que el runner lo ubica dentro de la página siguiendo el
            <code className="mx-1 rounded bg-page px-1 py-0.5">comment_id</code> del link. Si el comentario está
            detrás de un &quot;Ver más comentarios&quot;, la tarea lo abre sola hasta cuatro veces.
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Espera antes de buscar el comentario (ms)</label>
            <input
              type="number"
              min={0}
              value={waitMs}
              onChange={(e) => setWaitMs(Number(e.target.value))}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Prefijo de nombre</label>
            <input
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <p className="text-xs text-ink-muted">
            Ojo al repetir: si un perfil ya reaccionó, la tarea lo detecta y no toca nada — pero Facebook no
            siempre marca en el HTML que el comentario ya tiene tu reacción. En esos casos un segundo intento con
            el mismo perfil la quitaría en vez de ponerla.
          </p>
        </div>
      </Modal>
    </div>
  );
}
