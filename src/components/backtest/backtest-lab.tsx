"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  FlaskConical,
  Loader2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EquityChart } from "@/components/backtest/equity-chart";
import {
  runBacktestAction,
  type RunBacktestState,
} from "@/app/dashboard/estrategias/[id]/actions";
import { BACKTEST_PERIODS, BACKTEST_SYMBOLS } from "@/lib/backtest";
import { formatUsd, humanizeCandles } from "@/lib/format";
import type { StrategyParam } from "@/lib/strategies/types";

interface Props {
  strategyId: string;
  params: StrategyParam[];
  intervalo: string;
  modo: "allin" | "dca";
}

function Stat({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card className="border-white/5 bg-white/[0.02]">
      <CardContent className="pt-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${valueClassName}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

const pctAbs = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

// Veredicto sin ambigüedad: la palabra Ganó/Perdió + el número en verde/rojo.
function VerdictStat({ label, pct }: { label: string; pct: number }) {
  const won = pct >= 0;
  const Icon = won ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="border-white/5 bg-white/[0.02]">
      <CardContent className="pt-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={`mt-1 flex items-center gap-1.5 text-2xl font-semibold ${
            won ? "text-emerald-400" : "text-red-400"
          }`}
        >
          <Icon className="size-5" aria-hidden />
          {won ? "Ganó" : "Perdió"} {pctAbs.format(Math.abs(pct))}%
        </p>
      </CardContent>
    </Card>
  );
}

export function BacktestLab({ strategyId, params, intervalo, modo }: Props) {
  const [symbol, setSymbol] = useState<string>("BTC");
  const [period, setPeriod] = useState<string>("1a");
  const [capital, setCapital] = useState<string>("500");
  const [chunk, setChunk] = useState<string>("");
  const [paramValues, setParamValues] = useState<Record<string, string>>(
    Object.fromEntries(params.map((p) => [p.key, String(p.default)]))
  );
  const [state, setState] = useState<RunBacktestState | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await runBacktestAction({
        strategyId,
        symbol,
        period,
        capital,
        // El monto por compra del DCA se simula igual que lo usaría el robot
        // (vacío = default del robot: capital/10).
        params:
          modo === "dca" && chunk.trim() !== ""
            ? { ...paramValues, montoPorCompra: chunk }
            : paramValues,
      });
      setState(result);
    });
  }

  const result = state?.result;

  return (
    <div className="flex flex-col gap-8">
      <Card className="border-emerald-400/20 bg-emerald-500/[0.04]">
        <CardContent className="pt-2">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
            <FlaskConical className="size-5 text-emerald-400" />
            ¿Cómo le habría ido? Probala con precios pasados
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Esto es el <strong>backtesting</strong>: simulamos qué habría
            pasado si usabas esta estrategia en el pasado, con precios reales
            de Binance, incluyendo comisiones, deslizamiento y los stops
            evaluados vela por vela.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Moneda</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BACKTEST_SYMBOLS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s} / USDT
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Período</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BACKTEST_PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="capital">Capital inicial (USD)</Label>
              <Input
                id="capital"
                type="number"
                min={10}
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
              />
            </div>

            {modo === "dca" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="montoPorCompra">Monto por compra (USD)</Label>
                <Input
                  id="montoPorCompra"
                  type="number"
                  min={11}
                  placeholder={`${Math.max(11, Math.round(Number(capital) / 10 || 0))} (el robot usa capital ÷ 10)`}
                  value={chunk}
                  onChange={(e) => setChunk(e.target.value)}
                />
              </div>
            )}

            {params.map((p) => (
              <div key={p.key} className="flex flex-col gap-2">
                <Label htmlFor={p.key}>{p.label.replace(" (velas)", "")}</Label>
                <Input
                  id={p.key}
                  type="number"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={paramValues[p.key]}
                  onChange={(e) =>
                    setParamValues({
                      ...paramValues,
                      [p.key]: e.target.value,
                    })
                  }
                />
                {p.enVelas && Number(paramValues[p.key]) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {paramValues[p.key]} velas de {intervalo}{" "}
                    {humanizeCandles(Number(paramValues[p.key]), intervalo)}
                  </p>
                )}
              </div>
            ))}
          </div>

          <Button
            onClick={run}
            disabled={isPending}
            className="mt-6 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Simulando…
              </>
            ) : (
              "Simular"
            )}
          </Button>
        </CardContent>
      </Card>

      {state?.error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>No pudimos correr la simulación</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          {result.smallSample && (
            <Alert className="border-amber-400/30 bg-amber-500/[0.06] text-amber-200">
              <AlertCircle className="size-4 !text-amber-300" />
              <AlertTitle>
                Pocas operaciones como para sacar conclusiones firmes
              </AlertTitle>
              <AlertDescription className="text-amber-200/80">
                En el período elegido, la estrategia completó{" "}
                {result.roundTrips}{" "}
                {result.roundTrips === 1 ? "operación" : "operaciones"} de
                compra y venta. No es un error: hay estrategias que por diseño
                operan poco seguido (esperan rupturas o señales que pasan
                pocas veces al año). Pero con menos de 30 operaciones el
                resultado depende bastante de la suerte — tomalo como
                orientativo, y si podés, probá un período más largo.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <VerdictStat
              label="Con esta estrategia"
              pct={result.returnPct}
            />
            <VerdictStat
              label="Comprando y manteniendo (sin estrategia)"
              pct={result.buyHoldReturnPct}
            />
            <Stat
              label="Peor caída desde un máximo"
              value={`−${pctAbs.format(result.maxDrawdownPct)}%`}
              valueClassName="text-red-400"
            />
            <Stat
              label="Operaciones"
              value={`${result.numTrades}${
                result.winRatePct !== null
                  ? ` (${Math.round(result.winRatePct)}% ganadoras)`
                  : ""
              }`}
            />
            <Card className="border-white/5 bg-white/[0.02]">
              <CardContent className="pt-2">
                <p className="text-sm text-muted-foreground">
                  Qué dejaron sus operaciones cerradas
                </p>
                {result.roundTrips === 0 ? (
                  <p className="mt-1 text-2xl font-semibold">—</p>
                ) : (
                  <div className="mt-1.5 flex flex-col gap-0.5 text-base font-medium">
                    <span className="text-emerald-400">
                      Las que acertó sumaron {formatUsd(result.grossProfitUsd)}
                    </span>
                    <span className="text-red-400">
                      Las que falló restaron {formatUsd(result.grossLossUsd)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
            <Stat
              label="Costos pagados (comisión + spread)"
              value={formatUsd(result.costsUsd)}
            />
          </div>

          <Card className="border-white/5 bg-white/[0.02]">
            <CardContent className="pt-2">
              <p className="mb-4 text-sm text-muted-foreground">
                Así habría evolucionado tu capital de{" "}
                {formatUsd(result.investedUsd)} en {state?.symbol}/USDT — la
                estrategia terminó en{" "}
                <span className="font-medium text-foreground">
                  {formatUsd(result.finalValueUsd)}
                </span>
                . Simulado con{" "}
                {state?.feePersonalizada
                  ? `tu comisión real de Binance (${(state.feePct ?? 0.1).toString().replace(".", ",")}% por operación)`
                  : "la comisión estándar (0,1% por operación)"}{" "}
                más deslizamiento estimado.
              </p>
              <EquityChart curve={result.equityCurve} />
            </CardContent>
          </Card>

          <p className="text-xs leading-relaxed text-muted-foreground/70">
            Esto es una simulación sobre el pasado con supuestos simplificados
            — el futuro puede ser peor, y rendimientos pasados no garantizan
            rendimientos futuros. La simulación incluye la comisión indicada
            arriba y un deslizamiento estimado, y evalúa los stops contra el
            mínimo de cada vela para no inflar los resultados. Las
            criptomonedas pueden caer 50–90%: invertí solo plata que puedas
            permitirte perder. Esto no constituye asesoramiento financiero.
          </p>
        </div>
      )}
    </div>
  );
}
