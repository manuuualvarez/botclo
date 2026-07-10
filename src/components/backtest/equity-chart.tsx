"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquityPoint } from "@/lib/backtest";

// Forma "énfasis" (dataviz): la estrategia en el acento esmeralda, el
// benchmark de comprar-y-mantener en gris recesivo. Líneas de 2px, sin
// puntos, grilla hairline y tooltip con crosshair.

const dateShort = new Intl.DateTimeFormat("es-AR", {
  month: "short",
  year: "2-digit",
});
const dateFull = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
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

interface TooltipPayloadEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/95 px-3 py-2 text-sm shadow-xl">
      <p className="mb-1.5 font-medium">
        {label ? dateFull.format(new Date(label)) : ""}
      </p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="tabular-nums">
            {usdFull.format(Number(entry.value))}
          </span>
        </p>
      ))}
    </div>
  );
}

export function EquityChart({ curve }: { curve: EquityPoint[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={curve}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <CartesianGrid
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
            vertical={false}
          />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => dateShort.format(new Date(t))}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 12 }}
            tickCount={7}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={(v: number) => usdCompact.format(v)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 12 }}
            width={64}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
          />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 13, paddingTop: 8 }}
          />
          <Line
            name="Con la estrategia"
            dataKey="s"
            stroke="#34d399"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            name="Comprando y manteniendo"
            dataKey="b"
            stroke="#71717a"
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
