import Num from "@/components/ui/Num";

export default function Meter({
  label,
  value,
  total,
  valueLabel,
  accent = "var(--gold)",
}: {
  label: string;
  value: number;
  total: number;
  valueLabel?: string;
  accent?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-mono">{label}</p>
        <p className="font-mono text-[11px] font-medium text-ink tabular-nums">
          {valueLabel ?? (
            <>
              <Num t={value} />
              <span className="text-ink-muted"> / {total}</span>
            </>
          )}
        </p>
      </div>
      {/* El riel usa la rejilla (no un tinte del acento) para que la barra
          llena se lea como instrumento y no como dos tonos del mismo color. */}
      <div className="h-1.75 w-full overflow-hidden rounded-full bg-gridline">
        <div
          className="bar-grow h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 60%, transparent), ${accent})`,
          }}
        />
      </div>
    </div>
  );
}
