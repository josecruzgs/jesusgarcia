import { ExternalLink } from "lucide-react";

export type MentionRow = {
  _id: string;
  entity: string;
  provider: string;
  platform: string;
  sourceType: string;
  domain?: string;
  url: string;
  title?: string;
  text?: string;
  author?: string;
  authorFollowers?: number;
  publishedAt: string;
  sentiment?: "positive" | "neutral" | "negative";
  sentimentScore?: number;
  topics?: string[];
  aiSummary?: string;
  relevant?: boolean | null;
  irrelevantReason?: string;
  engagement?: { likes?: number; comments?: number; shares?: number; views?: number };
};

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "var(--ok)",
  neutral: "var(--text-muted)",
  negative: "var(--danger)",
};

const SENTIMENT_LABEL: Record<string, string> = {
  positive: "Favorable",
  neutral: "Neutral",
  negative: "Adverso",
};

function compact(n?: number): string | null {
  if (n === undefined || n === null) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export default function MentionCard({ mention }: { mention: MentionRow }) {
  const color = SENTIMENT_COLOR[mention.sentiment ?? ""] ?? "var(--text-muted)";
  const engagement = [
    { label: "❤", value: compact(mention.engagement?.likes) },
    { label: "💬", value: compact(mention.engagement?.comments) },
    { label: "↻", value: compact(mention.engagement?.shares) },
    { label: "▶", value: compact(mention.engagement?.views) },
  ].filter((e) => e.value);

  return (
    <article
      className={`card-surface px-4.5 py-4 ${mention.relevant === false ? "opacity-60" : ""}`}
      style={{ ["--edge-c" as string]: mention.relevant === false ? "var(--text-muted)" : color }}
    >
      {mention.relevant === false && (
        <p className="label-mono-sm mb-2 normal-case tracking-normal text-warning">
          Descartada por la IA: {mention.irrelevantReason || "no habla de la figura"}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="pill-mono"
          style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
        >
          {SENTIMENT_LABEL[mention.sentiment ?? ""] ?? "Sin analizar"}
          {mention.sentimentScore !== undefined && mention.sentimentScore !== null
            ? ` ${mention.sentimentScore > 0 ? "+" : ""}${mention.sentimentScore}`
            : ""}
        </span>
        <span className="label-mono-sm">{mention.entity}</span>
        <span className="label-mono-sm">·</span>
        <span className="label-mono-sm">{mention.domain || mention.platform}</span>
        <span className="label-mono-sm ml-auto">
          {new Date(mention.publishedAt).toLocaleString("es-MX", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <a
        href={mention.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group mt-2.5 flex items-start gap-1.5"
      >
        <h3 className="text-[14px] font-medium leading-snug text-ink transition-colors group-hover:text-gold">
          {mention.title || mention.text?.slice(0, 120) || mention.url}
        </h3>
        <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-muted transition-colors group-hover:text-gold" />
      </a>

      {mention.aiSummary && (
        <p className="font-display mt-2 text-[13px] italic leading-relaxed text-ink-secondary">
          {mention.aiSummary}
        </p>
      )}

      {(mention.topics?.length || mention.author || engagement.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {mention.topics?.map((topic) => (
            <span
              key={topic}
              className="rounded-[5px] border border-hairline px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-secondary"
            >
              {topic}
            </span>
          ))}
          {mention.author && (
            <span className="label-mono-sm normal-case tracking-normal">
              {mention.author}
              {mention.authorFollowers ? ` · ${compact(mention.authorFollowers)} seg.` : ""}
            </span>
          )}
          {engagement.length > 0 && (
            <span className="label-mono-sm ml-auto flex items-center gap-2.5">
              {engagement.map((e) => (
                <span key={e.label}>
                  {e.label} {e.value}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
