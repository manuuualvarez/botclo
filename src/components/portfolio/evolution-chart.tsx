"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SnapshotPoint } from "@/lib/binance/portfolio";

// Evolución del valor total. Serie única (sin leyenda: el título la nombra),
// línea 2px, grilla hairline, tooltip con crosshair.

const dateShort = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
});
const dateFull = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const usdCompact = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const usdFull = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function PointTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number | string }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/95 px-3 py-2 text-sm shadow-xl">
      <p className="mb-0.5 text-muted-foreground">
        {label ? dateFull.format(new Date(label)) : ""}
      </p>
      <p className="font-medium tabular-nums">
        {usdFull.format(Number(payload[0].value))}
      </p>
    </div>
  );
}

export function EvolutionChart({ points }: { points: SnapshotPoint[] }) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => dateShort.format(new Date(t))}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 12 }}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={(v: number) => usdCompact.format(v)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 12 }}
            width={64}
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={<PointTooltip />}
            cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
          />
          <Line
            dataKey="v"
            name="Valor de la cartera"
            stroke="#34d399"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
