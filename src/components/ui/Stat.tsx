import Link from "next/link";
import type { ReactNode } from "react";
import Num from "./Num";
import type { PanelCol } from "./Panel";

/**
 * Bloque de cifra de la sala: barra de acento vertical pegada al borde
 * izquierdo, etiqueta mono en versalitas, número grande tabular que cuenta
 * al montarse, y —opcional— una píldora de delta y una línea de contexto.
 */
export default function Stat({
  label,
  value,
  delta,
  sub,
  href,
  live,
  accent = "var(--gold)",
  col = 3,
  icon,
}: {
  label: ReactNode;
  value: string | number;
  /** Signo y magnitud del cambio; el color y la flecha salen del signo. */
  delta?: { value: number; suffix?: string };
  sub?: ReactNode;
  href?: string;
  /** Punto parpadeante junto a la etiqueta, para métricas que se refrescan solas. */
  live?: boolean;
  accent?: string;
  col?: PanelCol;
  icon?: ReactNode;
}) {
  const positive = (delta?.value ?? 0) >= 0;
  const deltaColor = positive ? "var(--ok)" : "var(--danger)";

  const body = (
    <>
      {/* Barra de acento: se degrada a 40% hacia abajo para que no compita
          con la cifra. */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-0.75"
        style={{ background: `linear-gradient(${accent}, color-mix(in srgb, ${accent} 40%, transparent))` }}
      />
      <div className="label-mono flex items-center gap-1.5">
        {label}
        {live && <span className="dot-live" style={{ background: accent }} />}
        {icon && (
          <span className="ml-auto shrink-0 opacity-70" style={{ color: accent }}>
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-2">
        <span className="stat-value">
          <Num t={value} />
        </span>
        {delta && (
          <span
            className="pill-mono"
            style={{ color: deltaColor, background: `color-mix(in srgb, ${deltaColor} 16%, transparent)` }}
          >
            {positive ? "▲" : "▼"} {Math.abs(delta.value)}
            {delta.suffix ?? ""}
          </span>
        )}
      </div>
      {sub && <div className="label-mono-sm mt-2 normal-case tracking-normal">{sub}</div>}
    </>
  );

  const className = `card-surface c${col} px-4.5 py-4 min-h-26 ${href ? "card-lift block" : ""}`;

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
