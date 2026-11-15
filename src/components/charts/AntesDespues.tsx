// Gráficas fijas del resumen de campañas en el Dashboard (copiadas del
// reporte público conversacion-tijuana.vercel.app). Son barras en CSS puro:
// pocas cifras cerradas, sin interacción, así que no vale cargar una librería
// de gráficas ni volverlo componente de cliente.

const ANTES = "color-mix(in srgb, var(--text-muted) 45%, transparent)";
const DESPUES = "var(--steel)";

export type Corte = { mes: string; antes: number; despues: number };

function Barra({ valor, max, sufijo, color, fuerte }: { valor: number; max: number; sufijo: string; color: string; fuerte?: boolean }) {
  // Una barra en 0 igual deja una raya, para que se lea "cero" y no "falta".
  const alto = Math.max(2, (valor / max) * 100);
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-end gap-1">
      <span
        className="tabular-nums text-[17px] font-semibold leading-none"
        style={{ color: fuerte ? DESPUES : "var(--text-secondary)" }}
      >
        {valor}
        {sufijo}
      </span>
      <div className="w-full rounded-t-sm" style={{ height: `${alto}%`, background: color }} />
    </div>
  );
}

/** Pares antes/después por mes, en columnas, sobre una misma escala. */
export function BarrasAntesDespues({ cortes, sufijo = "", max }: { cortes: Corte[]; sufijo?: string; max?: number }) {
  const tope = max ?? Math.max(...cortes.flatMap((c) => [c.antes, c.despues]));
  return (
    <div className="flex gap-5">
      {cortes.map((c) => (
        <div key={c.mes} className="flex flex-1 flex-col">
          <div className="flex h-36 items-end gap-2 border-b border-[var(--border-hi)] pb-px">
            <Barra valor={c.antes} max={tope} sufijo={sufijo} color={ANTES} />
            <Barra valor={c.despues} max={tope} sufijo={sufijo} color={DESPUES} fuerte />
          </div>
          <div className="label-mono-sm mt-1.5 flex">
            <span className="flex-1 text-center">Antes</span>
            <span className="flex-1 text-center">Después</span>
          </div>
          <p className="label-mono mt-1 text-center">{c.mes}</p>
        </div>
      ))}
    </div>
  );
}

/** Barra horizontal de una página: tramo "antes" y lo que creció encima. */
export function BarraPagina({ nombre, notas, antes, despues, max }: { nombre: string; notas: number; antes: number; despues: number; max: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12.5px] font-medium text-ink">
          {nombre} <span className="text-ink-muted">· {notas} notas</span>
        </span>
        <span className="tabular-nums text-[15px] font-semibold">
          <span className="text-ink-muted">{antes}</span>
          <span style={{ color: DESPUES }}> → {despues}</span>
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
        <div style={{ width: `${(antes / max) * 100}%`, background: ANTES }} />
        <div style={{ width: `${((despues - antes) / max) * 100}%`, background: DESPUES }} />
      </div>
    </div>
  );
}

export function LeyendaAntesDespues({ nota }: { nota?: string }) {
  return (
    <div className="label-mono-sm flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ANTES }} /> Antes
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DESPUES }} /> Después
      </span>
      {nota && <span className="normal-case tracking-normal">{nota}</span>}
    </div>
  );
}

export type CifraComparada = { value: string; label: string };

/**
 * Dos tarjetas lado a lado —antes apagada, ahora en verde— con una flecha en
 * medio. En pantallas chicas se apilan y la flecha apunta hacia abajo.
 */
export function ComparativaCortes({
  antes,
  ahora,
  etiquetaAntes = "Antes · corte 1",
  etiquetaAhora = "Ahora · corte 2",
}: {
  antes: CifraComparada[];
  ahora: CifraComparada[];
  etiquetaAntes?: string;
  etiquetaAhora?: string;
}) {
  const tarjeta = (titulo: string, cifras: CifraComparada[], destacada: boolean) => (
    <div
      className="flex flex-col gap-5 rounded-xl border p-5"
      style={
        destacada
          ? {
              background: "color-mix(in srgb, var(--steel) 14%, transparent)",
              borderColor: "color-mix(in srgb, var(--steel) 45%, transparent)",
            }
          : { background: "var(--surface-2)", borderColor: "var(--border-hairline)" }
      }
    >
      <p className="label-mono" style={destacada ? { color: DESPUES } : undefined}>
        {titulo}
      </p>
      {cifras.map((c) => (
        <div key={c.label}>
          <p
            className="tabular-nums text-[44px] font-bold leading-none tracking-tight"
            style={{ color: destacada ? DESPUES : "var(--text-muted)" }}
          >
            {c.value}
          </p>
          <p className="mt-1.5 max-w-[30ch] text-[13px] leading-snug text-ink-secondary">{c.label}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
      {tarjeta(etiquetaAntes, antes, false)}
      <span aria-hidden className="text-center text-3xl leading-none" style={{ color: DESPUES }}>
        <span className="hidden md:inline">→</span>
        <span className="md:hidden">↓</span>
      </span>
      {tarjeta(etiquetaAhora, ahora, true)}
    </div>
  );
}

/**
 * Fila compacta para la tabla de páginas: nombre y seguidores, la barra
 * (corte 1 + comentarios nuevos) y el antes → después a la derecha.
 */
export function FilaPagina({ nombre, seguidores, antes, despues, max }: { nombre: string; seguidores: string; antes: number; despues: number; max: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-3">
      <span className="truncate text-[12.5px] font-medium text-ink" title={`${nombre} · ${seguidores}`}>
        {nombre} <span className="label-mono-sm">{seguidores}</span>
      </span>
      <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
        <div style={{ width: `${(antes / max) * 100}%`, background: ANTES }} />
        <div style={{ width: `${((despues - antes) / max) * 100}%`, background: DESPUES }} />
      </div>
      <span className="w-[76px] text-right tabular-nums text-[13.5px] font-semibold">
        <span className="text-ink-muted">{antes}</span>
        <span style={{ color: DESPUES }}> → {despues}</span>
      </span>
    </div>
  );
}

/** Tarjetita de dato destacado con riel verde a la izquierda. */
export function DatoDestacado({ value, label }: { value: string; label: string }) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border-l-2 px-4 py-3"
      style={{ borderColor: DESPUES, background: "color-mix(in srgb, var(--steel) 10%, transparent)" }}
    >
      <span className="tabular-nums text-[30px] font-bold leading-none tracking-tight" style={{ color: DESPUES }}>
        {value}
      </span>
      <span className="text-[12px] leading-snug text-ink-secondary">{label}</span>
    </div>
  );
}
