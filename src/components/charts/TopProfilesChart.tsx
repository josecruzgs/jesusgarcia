"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList } from "recharts";
import type { TooltipContentProps } from "recharts";
import { AXIS_TICK_CATEGORY, MONO, TOOLTIP_BOX } from "./chartTheme";

export type ProfileRow = { name: string; count: number };

function BarTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className={TOOLTIP_BOX}>
      <p className="font-semibold tabular-nums text-ink">{p.value} completados</p>
      <p className="text-[10px] text-ink-muted">{(p.payload as ProfileRow).name}</p>
    </div>
  );
}

export default function TopProfilesChart({ data }: { data: ProfileRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center font-mono text-[11px] text-ink-muted">
        Aún no hay likes o comentarios exitosos.
      </div>
    );
  }

  const height = Math.max(140, data.length * 40);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, left: 4, bottom: 4 }} barCategoryGap="30%">
        {/* La barra va de un tinte del elemento a su color pleno: el mismo
            degradado horizontal que usan las barras del leaderboard de la
            sala, para que la punta sea lo que el ojo lee primero. */}
        <defs>
          <linearGradient id="bar-viento" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--el-viento)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--el-viento)" stopOpacity={1} />
          </linearGradient>
        </defs>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK_CATEGORY}
        />
        <Tooltip content={BarTooltip} cursor={{ fill: "var(--gridline)", fillOpacity: 0.5 }} />
        <Bar dataKey="count" fill="url(#bar-viento)" radius={[0, 4, 4, 0]} maxBarSize={18}>
          <LabelList
            dataKey="count"
            position="right"
            style={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: MONO }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
