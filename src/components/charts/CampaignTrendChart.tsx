"use client";

import { useState } from "react";
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import type { TooltipContentProps } from "recharts";
import { AXIS_TICK, GRID_STROKE, BASELINE_STROKE, TOOLTIP_BOX } from "./chartTheme";

export type TrendPoint = { day: string; label: string; likes: number; comments: number };

// Paleta categórica, no colores de elemento: las dos series tienen que
// distinguirse entre sí, y --el-agua ahora resuelve al mismo acento que
// --gold (ver globals.css), lo que dejaba las dos curvas del mismo color.
const SERIES = [
  { key: "likes", name: "Likes completados", color: "var(--series-1)" },
  { key: "comments", name: "Comentarios completados", color: "var(--gold)" },
] as const;

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <p className="mb-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-muted">{label}</p>
      <div className="flex flex-col gap-1">
        {payload.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-xs" style={{ backgroundColor: p.color }} />
            <span className="font-semibold tabular-nums text-ink">{p.value}</span>
            <span className="text-ink-muted">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CampaignTrendChart({ data }: { data: TrendPoint[] }) {
  const [showTable, setShowTable] = useState(false);
  const totalLikes = data.reduce((s, d) => s + d.likes, 0);
  const totalComments = data.reduce((s, d) => s + d.comments, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3.5 font-mono text-[10px] text-ink-secondary">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted transition-colors hover:text-gold"
        >
          {showTable ? "Ver gráfico" : "Ver como tabla"}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-72 overflow-y-auto rounded-[10px] border border-hairline">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-2 text-left">
              <tr>
                {["Día", "Likes", "Comentarios"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 font-mono text-[9px] font-medium uppercase tracking-[0.09em] text-ink-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-hairline">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-ink-secondary">{d.label}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] tabular-nums text-ink">{d.likes}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] tabular-nums text-ink">{d.comments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : totalLikes === 0 && totalComments === 0 ? (
        <div className="flex h-64 items-center justify-center font-mono text-[11px] text-ink-muted">
          Todavía no hay campañas completadas en estos 14 días.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          {/* left: -8 recupera parte del hueco que Recharts reserva a la
              izquierda del eje Y, pero no más: pasarse recorta las etiquetas
              de dos y tres cifras. */}
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            {/* Relleno degradado bajo cada línea: da volumen a la tendencia
                sin tapar la serie de atrás (arranca en 28% y muere en 0). */}
            <defs>
              {SERIES.map((s) => (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: BASELINE_STROKE }}
              tick={AXIS_TICK}
              minTickGap={24}
            />
            <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={38} allowDecimals={false} />
            <Tooltip content={ChartTooltip} cursor={{ stroke: BASELINE_STROKE, strokeWidth: 1 }} />
            {SERIES.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#fill-${s.key})`}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--page-plane)", strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
