// Ajustes compartidos por todos los gráficos, para que ejes, rejilla y
// tooltips se lean como instrumentación de la sala y no como el default de
// Recharts: todo lo numérico va en mono, chico y en el gris apagado, y solo
// el dato en sí usa el color de su serie.

export const MONO = "var(--font-plex-mono), ui-monospace, monospace";

export const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 10, fontFamily: MONO } as const;

export const AXIS_TICK_CATEGORY = {
  fill: "var(--text-secondary)",
  fontSize: 11,
  fontFamily: "var(--font-inter), sans-serif",
} as const;

export const GRID_STROKE = "var(--gridline)";
export const BASELINE_STROKE = "var(--baseline)";

// Clases del contenedor del tooltip. La sombra larguísima y muy difusa es lo
// que lo despega del panel sin necesidad de un borde fuerte.
export const TOOLTIP_BOX =
  "rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-[11px] shadow-[var(--shadow-flyout)]";
