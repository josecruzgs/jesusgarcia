// Un solo color por estado: el texto, el punto, el borde y el tinte del
// fondo salen todos del mismo valor vía color-mix, así nunca se
// desincronizan.
const COLORS: Record<string, string> = {
  pending: "var(--text-muted)",
  queued: "var(--blue)",
  running: "var(--amber)",
  // Naranja del semáforo, no el de Fuego: "pausada" es un estado, y los
  // estados no pueden seguir al acento del usuario o dejarían de distinguirse
  // entre sí (ver --el-* en globals.css, que ahora son todos el acento).
  paused: "var(--status-serious)",
  success: "var(--ok)",
  failed: "var(--danger)",
  // "partial" = terminó con algunas fallidas mezcladas entre las exitosas —
  // sigue siendo un resultado mayormente bueno, así que se pinta en el teal
  // (no en el naranja de "paused") y se etiqueta "Exitosa (P)" para dejar
  // claro que es una variante de éxito, no un estado de alerta.
  partial: "var(--teal)",
  empty: "var(--text-muted)",
  cancelled: "var(--text-muted)",
  active: "var(--ok)",
  inactive: "var(--text-muted)",
  unknown: "var(--text-muted)",
};

const LABELS: Record<string, string> = {
  pending: "Pendiente",
  queued: "En cola",
  running: "Corriendo",
  paused: "Pausada",
  success: "Exitosa",
  failed: "Fallida",
  partial: "Exitosa (P)",
  empty: "Vacía",
  cancelled: "Cancelada",
  active: "Activo",
  inactive: "Inactivo",
  unknown: "Desconocido",
};

// Los estados en curso llevan el punto parpadeando, igual que el indicador
// "EN VIVO" de la topbar: la animación es lo que distingue "está pasando
// ahora" de "así quedó".
const LIVE = new Set(["running", "queued"]);

export default function StatusBadge({ status }: { status: string }) {
  const c = COLORS[status] ?? COLORS.unknown;

  return (
    <span
      className="inline-flex w-30 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 py-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em]"
      style={{
        color: c,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 38%, transparent)`,
      }}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${LIVE.has(status) ? "dot-live" : ""}`}
        style={{ background: c }}
      />
      {LABELS[status] ?? status}
    </span>
  );
}
