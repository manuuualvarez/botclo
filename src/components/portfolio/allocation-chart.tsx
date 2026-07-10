"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Holding } from "@/lib/binance/portfolio";

// Distribución de la cartera. Paleta categórica validada (modo oscuro),
// asignada en orden fijo — nunca cicla: más de 6 activos se pliegan en
// "Otros". La tabla de tenencias es la vista-tabla accesible del mismo dato.
const PALETTE = [
  "#3987e5", // azul
  "#199e70", // aqua
  "#c98500", // amarillo
  "#008300", // verde
  "#9085e9", // violeta
  "#e66767", // rojo
  "#d55181", // magenta (slot de "Otros")
];

const usdFull = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

interface Slice {
  name: string;
  value: number;
  pct: number;
}

function buildSlices(holdings: Holding[]): Slice[] {
  const priced = holdings.filter((h) => h.valueUsd > 0);
  const total = priced.reduce((sum, h) => sum + h.valueUsd, 0);
  if (total <= 0) return [];

  const top = priced.slice(0, 6);
  const rest = priced.slice(6);
  const slices: Slice[] = top.map((h) => ({
    name: h.asset,
    value: h.valueUsd,
    pct: (h.valueUsd / total) * 100,
  }));
  const otherValue = rest.reduce((sum, h) => sum + h.valueUsd, 0);
  if (otherValue > 0) {
    slices.push({
      name: "Otros",
      value: otherValue,
      pct: (otherValue / total) * 100,
    });
  }
  return slices;
}

function SliceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: Slice }[];
}) {
  const slice = payload?.[0]?.payload;
  if (!active || !slice) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/95 px-3 py-2 text-sm shadow-xl">
      <p className="font-medium">{slice.name}</p>
      <p className="tabular-nums text-muted-foreground">
        {usdFull.format(slice.value)} · {slice.pct.toFixed(1)}%
      </p>
    </div>
  );
}

export function AllocationChart({ holdings }: { holdings: Holding[] }) {
  const slices = buildSlices(holdings);
  if (slices.length === 0) return null;

  return (
    <div className="flex items-center gap-6">
      <div className="h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="transparent"
              isAnimationActive={false}
            >
              {slices.map((slice, i) => (
                <Cell key={slice.name} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<SliceTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Leyenda con identidad por swatch — el texto usa tokens de texto */}
      <ul className="flex min-w-0 flex-1 flex-col gap-2">
        {slices.map((slice, i) => (
          <li
            key={slice.name}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              />
              <span className="truncate font-medium">{slice.name}</span>
            </span>
            <span className="tabular-nums text-muted-foreground">
              {slice.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
