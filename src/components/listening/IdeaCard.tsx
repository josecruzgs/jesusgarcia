"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, Copy, Check, Trash2 } from "lucide-react";
import { BRIEF_ICON_MAP } from "./briefIcons";

export type ImageIdeaRow = {
  _id: string;
  kind: "accion" | "publicacion";
  title: string;
  detail: string;
  icon: string;
  priority: "alta" | "media" | "baja";
  draft?: string;
  platform?: string;
  format?: string;
  kept?: boolean;
  createdAt?: string;
};

const PRIORITY_COLOR: Record<string, string> = {
  alta: "var(--danger)",
  media: "var(--amber)",
  baja: "var(--text-muted)",
};

/**
 * Una idea de imagen. Dos variantes en una sola tarjeta: la de acción termina
 * en el "por qué", y la de publicación además muestra el borrador del texto
 * con un botón para copiarlo — que es lo único que hace falta para llevárselo
 * al gestor de redes.
 */
export default function IdeaCard({
  idea,
  busy,
  onKeep,
  onDelete,
}: {
  idea: ImageIdeaRow;
  busy: boolean;
  onKeep: (kept: boolean) => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const TopicIcon = BRIEF_ICON_MAP[idea.icon] ?? BRIEF_ICON_MAP.oportunidad;

  async function copyDraft() {
    if (!idea.draft) return;
    await navigator.clipboard.writeText(idea.draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const meta = [idea.platform, idea.format].filter(Boolean).join(" · ");

  return (
    <article className="card-surface flex flex-col gap-2.5 px-4 py-3.5">
      <header className="flex items-start gap-2.5">
        <span className="accent-fill mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border">
          <TopicIcon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[13.5px] font-semibold leading-snug text-ink">{idea.title}</h4>
          <p className="label-mono-sm mt-1 flex flex-wrap items-center gap-x-2 normal-case tracking-normal">
            <span style={{ color: PRIORITY_COLOR[idea.priority] }}>
              prioridad {idea.priority}
            </span>
            {meta && <span>· {meta}</span>}
          </p>
        </div>
        <button
          onClick={() => onKeep(!idea.kept)}
          disabled={busy}
          title={idea.kept ? "Guardada: sobrevive a la próxima generación" : "Guardar esta idea"}
          aria-label={idea.kept ? "Quitar de guardadas" : "Guardar idea"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors"
          style={{ color: idea.kept ? "var(--gold)" : "var(--text-muted)" }}
        >
          {idea.kept ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        </button>
      </header>

      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{idea.detail}</p>

      {idea.draft && (
        <div className="rounded-[9px] border border-hairline bg-surface-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="label-mono">Borrador</span>
            <button
              onClick={copyDraft}
              className="label-mono-sm inline-flex items-center gap-1 normal-case tracking-normal transition-colors hover:text-gold"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
            {idea.draft}
          </p>
        </div>
      )}

      <footer className="flex justify-end">
        <button
          onClick={onDelete}
          disabled={busy}
          aria-label="Borrar idea"
          className="label-mono-sm inline-flex items-center gap-1 normal-case tracking-normal text-ink-muted transition-colors hover:text-critical"
        >
          <Trash2 className="h-3 w-3" /> Borrar
        </button>
      </footer>
    </article>
  );
}
