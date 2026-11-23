/**
 * Piezas del tablero de Encuestas, hechas con el sistema visual del panel
 * (card-surface, etiquetas mono, botones tbtn) para que la sección se vea como
 * el resto del panel y no como otra app pegada. Los estilos de la tabla y
 * las barras viven en globals.css, bajo "Encuestas".
 */
export const n = (x: number) => x.toLocaleString("es-MX");

/** Clases de formulario que se repiten en todas las pantallas de Encuestas. */
export const INPUT =
  "w-full rounded-lg border border-hairline bg-page px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-primary disabled:opacity-60";
export const LABEL = "mb-1 block text-xs text-ink-muted";
export const BTN_PRIMARY =
  "glow-btn inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50";
export const BTN = "tbtn inline-flex items-center justify-center gap-1.5 disabled:opacity-50";

export function Carta({
  id,
  titulo,
  subtitulo,
  extra,
  children,
  className = "",
  accent,
}: {
  id?: string;
  titulo?: string;
  subtitulo?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  accent?: string;
}) {
  return (
    <section
      id={id}
      className={`card-surface scroll-mt-28 p-5 ${className}`}
      style={accent ? { ["--edge-c" as string]: accent } : undefined}
    >
      {(titulo || extra) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {titulo && <h2 className="font-display text-[17px] font-semibold leading-tight text-ink">{titulo}</h2>}
            {subtitulo && <p className="mt-1 text-[13px] leading-snug text-ink-muted">{subtitulo}</p>}
          </div>
          {extra}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  etiqueta,
  valor,
  pie,
  color = "var(--primary)",
}: {
  etiqueta: string;
  valor: React.ReactNode;
  pie?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="card-surface px-5 py-4" style={{ ["--edge-c" as string]: color }}>
      <p className="label-mono-sm">{etiqueta}</p>
      <p className="mt-1 font-mono text-[32px] font-semibold leading-none tabular-nums" style={{ color }}>
        {valor}
      </p>
      {pie && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted">{pie}</p>}
    </div>
  );
}

/** Una respuesta con su barra: nombre, porcentaje grande y cuántas personas. */
export function Barra({ nombre, pct, votos, color, lider = false }: { nombre: string; pct: number; votos: number; color: string; lider?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className={lider ? "font-semibold text-ink" : "text-ink-secondary"}>{nombre}</span>
        <span className="whitespace-nowrap">
          <b className="font-mono text-[16px] tabular-nums" style={{ color: lider ? color : "var(--text-primary)" }}>
            {pct}%
          </b>{" "}
          <span className="text-[12px] text-ink-muted">· {n(votos)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className="enc-barra h-full rounded-full" style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%`, background: color }} />
      </div>
    </div>
  );
}

export function Pastilla({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-[12px] font-semibold"
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      {children}
    </span>
  );
}

/** El aviso de arriba después de una acción (?ok= o ?error=). */
export function Aviso({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <p className={`rounded-lg p-3 text-sm ${ok ? "bg-success/10 text-success" : "bg-critical/10 text-critical"}`}>{ok ?? error}</p>
  );
}
