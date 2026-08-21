"use client";

import { useState } from "react";
import { ExternalLink, MessageSquare, Heart, Plus, X, Rocket } from "lucide-react";
import { BRIEF_ICON_MAP } from "./briefIcons";

export type ActionPlayRow = {
  _id: string;
  kind: "comment" | "like";
  reaction: string;
  headline: string;
  rationale: string;
  icon: string;
  priority: "alta" | "media" | "baja";
  suggestedCount: number;
  comments: string[];
  status: "suggested" | "approved" | "dispatched" | "discarded";
  campaignId?: string | null;
  taskCount?: number;
  dispatchedAt?: string | null;
  createdAt?: string;
  target: {
    url: string;
    platform?: string | null;
    domain?: string | null;
    title?: string | null;
    excerpt?: string | null;
    author?: string | null;
    entity?: string | null;
    publishedAt?: string | null;
    sentiment?: string | null;
    sentimentScore?: number | null;
    engagement?: number;
    reach?: number;
  };
};

const KIND_META = {
  comment: { label: "Comentar", icon: MessageSquare, color: "var(--el-agua)" },
  like: { label: "Reaccionar", icon: Heart, color: "var(--danger)" },
} as const;

const PRIORITY_COLOR: Record<string, string> = {
  alta: "var(--danger)",
  media: "var(--amber)",
  baja: "var(--text-muted)",
};

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
};

const REACTION_LABEL: Record<string, string> = {
  like: "👍 Me gusta",
  love: "❤️ Me encanta",
  care: "🤗 Me importa",
  haha: "😆 Me divierte",
  wow: "😮 Me asombra",
  sad: "😢 Me entristece",
  angry: "😡 Me enoja",
};

const inputClass =
  "w-full rounded-[9px] border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary";

export default function PlayCard({
  play,
  busy,
  onSave,
  onStatus,
  onDispatch,
  onDelete,
}: {
  play: ActionPlayRow;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onStatus: (status: "approved" | "discarded" | "suggested") => void;
  onDispatch: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [comments, setComments] = useState(play.comments);
  const [count, setCount] = useState(play.suggestedCount);

  const kind = KIND_META[play.kind];
  const KindIcon = kind.icon;
  const TopicIcon = BRIEF_ICON_MAP[play.icon] ?? BRIEF_ICON_MAP.alerta;

  const score = play.target.sentimentScore;
  const scoreColor =
    score === null || score === undefined
      ? "var(--text-muted)"
      : score > 10
        ? "var(--ok)"
        : score < -10
          ? "var(--danger)"
          : "var(--amber)";

  const dispatched = play.status === "dispatched";

  // En una jugada de comentario las cuentas no se eligen: son una por texto.
  // Repetir un comentario en la misma publicación es la huella que delata una
  // operación, así que en vez de avisarlo se hace imposible — agregar un texto
  // es lo que suma una cuenta.
  const accounts = play.kind === "comment" ? comments.length : count;

  async function save() {
    await onSave(
      play.kind === "comment" ? { comments } : { suggestedCount: count },
    );
    setEditing(false);
  }

  return (
    <article
      className={`card-surface flex flex-col gap-3.5 px-4.5 py-4 ${play.status === "discarded" ? "opacity-55" : ""}`}
      style={{ ["--edge-c" as string]: kind.color }}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          {/* Relleno con el acento, no con el color de la jugada: `like` usa
              --danger y un rojo sólido con la tinta del acento encima no tiene
              contraste garantizado. Comentar y reaccionar se distinguen por el
              filo de la tarjeta y por la etiqueta de abajo, que sí llevan el
              color de la jugada. */}
          <span className="accent-fill mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border">
            <TopicIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold leading-snug text-ink">{play.headline}</h3>
            <p className="label-mono-sm mt-1 flex flex-wrap items-center gap-x-2 normal-case tracking-normal">
              <span className="inline-flex items-center gap-1" style={{ color: kind.color }}>
                <KindIcon className="h-3 w-3" />
                {kind.label}
                {play.kind === "like" && ` · ${REACTION_LABEL[play.reaction] ?? play.reaction}`}
              </span>
              <span style={{ color: PRIORITY_COLOR[play.priority] }}>
                prioridad {play.priority}
              </span>
              <span>
                {accounts} cuenta{accounts === 1 ? "" : "s"}
                {play.kind === "comment" && " · un texto cada una"}
              </span>
            </p>
          </div>
        </div>

        {dispatched && (
          <span className="pill-mono" style={{ color: "var(--ok)" }}>
            {play.taskCount} tarea{play.taskCount === 1 ? "" : "s"} creada
            {play.taskCount === 1 ? "" : "s"}
          </span>
        )}
      </header>

      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{play.rationale}</p>

      {/* La publicación sobre la que se actúa. Va con su score porque es el
          dato que justifica la jugada: sin él, "comentar acá" es una orden sin
          motivo visible. */}
      <div className="rounded-[9px] border border-hairline bg-surface-2 px-3 py-2.5">
        <p className="label-mono-sm flex flex-wrap items-center gap-x-2 normal-case tracking-normal">
          <span className="text-ink-secondary">
            {PLATFORM_LABEL[play.target.platform ?? ""] ?? play.target.platform ?? "—"}
          </span>
          {play.target.author && <span>· {play.target.author}</span>}
          {play.target.publishedAt && (
            <span>
              ·{" "}
              {new Date(play.target.publishedAt).toLocaleDateString("es-MX", {
                day: "2-digit",
                month: "short",
              })}
            </span>
          )}
          {score !== null && score !== undefined && (
            <span className="tabular-nums" style={{ color: scoreColor }}>
              · {score > 0 ? `+${score}` : score}
            </span>
          )}
          {Boolean(play.target.engagement) && <span>· {play.target.engagement} interacciones</span>}
        </p>
        {(play.target.title || play.target.excerpt) && (
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-ink">
            {play.target.title || play.target.excerpt}
          </p>
        )}
        <a
          href={play.target.url}
          target="_blank"
          rel="noreferrer"
          className="label-mono-sm mt-1.5 inline-flex items-center gap-1 normal-case tracking-normal transition-colors hover:text-gold"
        >
          Abrir la publicación <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {play.kind === "like" && editing && (
        <label className="label-mono-sm normal-case tracking-normal">
          Cuentas que reaccionan
          <input
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            className="ml-2 w-16 rounded-[7px] border border-hairline bg-page px-2 py-1 font-mono text-[11px] outline-none focus:border-primary"
          />
        </label>
      )}

      {play.kind === "comment" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="label-mono">
              {editing ? "Un texto por cuenta" : `${play.comments.length} comentarios propuestos`}
            </span>
          </div>

          {editing ? (
            <>
              {comments.map((text, i) => (
                <div key={i} className="flex items-start gap-2">
                  <textarea
                    rows={2}
                    value={text}
                    onChange={(e) =>
                      setComments(comments.map((c, j) => (j === i ? e.target.value : c)))
                    }
                    className={`${inputClass} text-[12.5px]`}
                  />
                  <button
                    onClick={() => setComments(comments.filter((_, j) => j !== i))}
                    aria-label="Quitar texto"
                    className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:text-critical"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setComments([...comments, ""])}
                  className="tbtn inline-flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar texto
                </button>
                <span className="label-mono-sm normal-case tracking-normal">
                  {comments.length} texto{comments.length === 1 ? "" : "s"} = {comments.length}{" "}
                  cuenta{comments.length === 1 ? "" : "s"}
                </span>
              </div>
            </>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {play.comments.map((text, i) => (
                <li
                  key={i}
                  className="rounded-[8px] border border-hairline px-3 py-2 text-[12.5px] leading-snug text-ink-secondary"
                >
                  {text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        {dispatched ? (
          <>
            <a href={`/campanas?campaignId=${play.campaignId}`} className="tbtn">
              Ver la campaña
            </a>
            <span className="label-mono-sm normal-case tracking-normal">
              ejecutada el{" "}
              {play.dispatchedAt ? new Date(play.dispatchedAt).toLocaleString("es-MX") : "—"}
            </span>
          </>
        ) : (
          <>
            {editing ? (
              <>
                <button onClick={save} disabled={busy} className="tbtn">
                  Guardar
                </button>
                <button
                  onClick={() => {
                    setComments(play.comments);
                    setCount(play.suggestedCount);
                    setEditing(false);
                  }}
                  className="tbtn"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onDispatch}
                  disabled={busy}
                  className="tbtn inline-flex items-center gap-1.5"
                  style={{ color: kind.color, borderColor: `color-mix(in srgb, ${kind.color} 45%, transparent)` }}
                >
                  <Rocket className="h-3.5 w-3.5" /> Activar campaña
                </button>
                <button onClick={() => setEditing(true)} className="tbtn">
                  Editar
                </button>
                {play.status === "approved" ? (
                  <button onClick={() => onStatus("suggested")} disabled={busy} className="tbtn">
                    Quitar aprobación
                  </button>
                ) : (
                  <button onClick={() => onStatus("approved")} disabled={busy} className="tbtn">
                    Aprobar
                  </button>
                )}
                {play.status === "discarded" ? (
                  <button
                    onClick={onDelete}
                    disabled={busy}
                    className="tbtn ml-auto hover:border-critical hover:text-critical"
                  >
                    Borrar
                  </button>
                ) : (
                  <button
                    onClick={() => onStatus("discarded")}
                    disabled={busy}
                    className="tbtn ml-auto hover:border-critical hover:text-critical"
                  >
                    Descartar
                  </button>
                )}
              </>
            )}
          </>
        )}
      </footer>
    </article>
  );
}
