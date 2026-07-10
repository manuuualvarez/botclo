"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAmount, formatPct, formatUsd } from "@/lib/format";
import type { Holding } from "@/lib/binance/portfolio";

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${
        up ? "text-emerald-400" : "text-red-400"
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
      {formatPct(value)}
    </span>
  );
}

// Barra de asignación: un solo tono (magnitud), pista en un paso más claro
// del mismo tono.
function Allocation({ pct }: { pct: number }) {
  return (
    <div className="flex items-center justify-end gap-2.5">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-emerald-500/15"
        role="presentation"
      >
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="w-14 text-right">{pct.toFixed(1).replace(".", ",")}%</span>
    </div>
  );
}

const DUST_THRESHOLD_USD = 1;

export function HoldingsTable({
  holdings,
  unpricedAssets,
}: {
  holdings: Holding[];
  unpricedAssets: string[];
}) {
  const [query, setQuery] = useState("");
  const [hideDust, setHideDust] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return holdings.filter((h) => {
      if (q && !h.asset.toUpperCase().includes(q)) return false;
      if (hideDust && h.priceUsd !== null && h.valueUsd < DUST_THRESHOLD_USD) {
        return false;
      }
      return true;
    });
  }, [holdings, query, hideDust]);

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 px-4 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar activo (ej: BTC)"
            className="pl-9"
            aria-label="Buscar activo"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="hide-dust"
            checked={hideDust}
            onCheckedChange={setHideDust}
          />
          <Label
            htmlFor="hide-dust"
            className="cursor-pointer text-sm text-muted-foreground"
          >
            Ocultar montos menores a US$ 1
          </Label>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-white/5 hover:bg-transparent">
            <TableHead>Activo</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="text-right">Precio</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="text-right">24 h</TableHead>
            <TableHead className="text-right">Parte de tu cartera</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-8 text-center text-muted-foreground"
              >
                Ningún activo coincide con la búsqueda.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((h) => (
              <TableRow key={h.asset} className="border-white/5">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-white/5 text-xs font-semibold ring-1 ring-white/10">
                      {h.asset.slice(0, 3)}
                    </span>
                    <span className="font-medium">{h.asset}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(h.amount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {h.priceUsd === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatUsd(h.priceUsd)
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {h.priceUsd === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatUsd(h.valueUsd)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Change value={h.change24hPct} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Allocation pct={h.allocationPct} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {unpricedAssets.length > 0 && (
        <p className="border-t border-white/5 px-4 py-3 text-xs text-muted-foreground">
          No encontramos precio en dólares para: {unpricedAssets.join(", ")}.
          Esos activos no suman al valor total.
        </p>
      )}
    </div>
  );
}
