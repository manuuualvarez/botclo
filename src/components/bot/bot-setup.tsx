"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Bot, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { createBotAction } from "@/app/dashboard/robot/actions";
import { RealRiskModal } from "@/components/bot/real-risk-modal";
import { BACKTEST_SYMBOLS } from "@/lib/backtest";
import { formatUsd, humanizeCandles } from "@/lib/format";
import { INTERVAL_LABELS, type KlineInterval } from "@/lib/intervals";

interface StrategyOption {
  id: string;
  nombre: string;
  resumen: string;
  modo: "allin" | "dca";
  intervalo: string;
  params: {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
    enVelas?: boolean;
  }[];
}


const BUDGET_PRESETS = [
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
  { label: "75%", fraction: 0.75 },
  { label: "Todo", fraction: 1 },
];

// Vuelve a pedir el saldo (router.refresh re-corre el server component):
// clave cuando el usuario acaba de convertir o depositar USDT en Binance.
function RefreshBalanceButton({
  isRefreshing,
  onRefresh,
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={onRefresh}
      disabled={isRefreshing}
    >
      <RefreshCw className={`size-3 ${isRefreshing ? "animate-spin" : ""}`} />
      {isRefreshing ? "Actualizando…" : "Actualizar saldo"}
    </Button>
  );
}

export function BotSetup({
  strategies,
  initialStrategyId,
  isTestnet,
  availableUsdt,
}: {
  strategies: StrategyOption[];
  initialStrategyId?: string;
  isTestnet: boolean;
  availableUsdt: number | null;
}) {
  const router = useRouter();
  const [strategyId, setStrategyId] = useState(
    strategies.some((s) => s.id === initialStrategyId)
      ? initialStrategyId!
      : strategies[0].id
  );
  const strategy = strategies.find((s) => s.id === strategyId)!;

  const [symbol, setSymbol] = useState<string>("BTC");
  const interval = strategy.intervalo;
  const [budget, setBudget] = useState<string>("");
  const [chunk, setChunk] = useState<string>("50");
  const [paramValues, setParamValues] = useState<Record<string, string>>(
    Object.fromEntries(strategy.params.map((p) => [p.key, String(p.default)]))
  );
  const [error, setError] = useState<string | null>(null);
  const [riskOpen, setRiskOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // router.refresh() re-ejecuta el server component de la página, que baja
  // el saldo de Binance sin caché — así el usuario que acaba de fondear la
  // cuenta ve la plata sin recargar todo a mano.
  const [isRefreshing, startRefresh] = useTransition();

  function selectStrategy(id: string) {
    const next = strategies.find((s) => s.id === id)!;
    setStrategyId(id);
    setParamValues(
      Object.fromEntries(next.params.map((p) => [p.key, String(p.default)]))
    );
  }

  // En modo real, "Activar" abre primero el modal de riesgo; recién su
  // confirmación llama a create(). En modo práctica, activa directo.
  function onActivate() {
    setError(null);
    const amount = Number(budget);
    if (!Number.isFinite(amount) || amount < 25) {
      setError(
        "Ingresá un presupuesto de al menos 25 USDT — recomendamos 50 o más para que las ventas nunca queden por debajo del mínimo de Binance."
      );
      return;
    }
    if (isTestnet) create();
    else setRiskOpen(true);
  }

  function create() {
    startTransition(async () => {
      const result = await createBotAction({
        strategyId,
        symbol,
        budget,
        aceptaRiesgoReal: !isTestnet,
        params: {
          ...Object.fromEntries(
            Object.entries(paramValues).map(([k, v]) => [k, Number(v)])
          ),
          ...(strategy.modo === "dca" ? { montoPorCompra: Number(chunk) } : {}),
        },
      });
      if (result.error) {
        setError(result.error);
        setRiskOpen(false);
      } else {
        router.push("/dashboard/robot");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {isTestnet && (
        <Badge
          variant="outline"
          className="w-fit gap-1.5 border-amber-400/30 bg-amber-500/10 text-amber-300"
        >
          <FlaskConical className="size-3.5" />
          Modo práctica — el robot opera con fondos ficticios del testnet
        </Badge>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>No pudimos activar el robot</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Paso 1: estrategia */}
      <Card className="border-white/5 bg-white/[0.02]">
        <CardContent className="pt-2">
          <h2 className="mb-4 font-semibold">
            <span className="mr-2 text-emerald-400">1.</span>
            Elegí la estrategia
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {strategies.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectStrategy(s.id)}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  s.id === strategyId
                    ? "border-emerald-400/50 bg-emerald-500/[0.08]"
                    : "border-white/10 bg-white/[0.02] hover:border-emerald-400/30"
                }`}
              >
                <p className="font-medium">{s.nombre}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {s.resumen}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Paso 2: mercado y ritmo */}
      <Card className="border-white/5 bg-white/[0.02]">
        <CardContent className="pt-2">
          <h2 className="mb-4 font-semibold">
            <span className="mr-2 text-emerald-400">2.</span>
            Elegí el mercado y el ritmo
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
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
              <Label>Frecuencia de decisión</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-transparent px-3 text-sm">
                {INTERVAL_LABELS[interval as KlineInterval] ?? interval}
              </div>
              <p className="text-xs text-muted-foreground">
                La define la estrategia: es la misma frecuencia con la que se
                simula en el laboratorio.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Paso 3: presupuesto y límites */}
      <Card className="border-white/5 bg-white/[0.02]">
        <CardContent className="pt-2">
          <h2 className="mb-1 font-semibold">
            <span className="mr-2 text-emerald-400">3.</span>
            Definí el presupuesto
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            El robot nunca va a usar más que este monto. Lo podés pausar o
            eliminar cuando quieras.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="budget">Presupuesto máximo (USDT)</Label>
              <Input
                id="budget"
                type="number"
                min={25}
                placeholder="Ej: 500 (mínimo 25, recomendado 50+)"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
              {availableUsdt !== null ? (
                <>
                  {availableUsdt >= 25 ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {BUDGET_PRESETS.map((preset) => (
                          <Button
                            key={preset.label}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() =>
                              setBudget(
                                String(
                                  Math.floor(availableUsdt * preset.fraction)
                                )
                              )
                            }
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          Tenés {formatUsd(availableUsdt)} disponibles en USDT.
                        </p>
                        <RefreshBalanceButton
                          isRefreshing={isRefreshing}
                          onRefresh={() => startRefresh(() => router.refresh())}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs leading-relaxed text-amber-200">
                        El robot opera únicamente con USDT, y en tu cuenta hay{" "}
                        {formatUsd(availableUsdt)} libres — no alcanza para el
                        presupuesto mínimo (25 USDT). Para fondearlo, convertí
                        parte de otro activo a USDT en Binance (opción
                        «Convertir» en su app) y volvé acá. El resto de tus
                        activos no se toca: los robots solo gastan el USDT que
                        les asignás.
                      </p>
                      <RefreshBalanceButton
                        isRefreshing={isRefreshing}
                        onRefresh={() => startRefresh(() => router.refresh())}
                      />
                    </>
                  )}
                  {Number(budget) > availableUsdt && (
                    <p className="text-xs text-amber-300">
                      Ojo: ese monto supera tu saldo disponible. El robot va a
                      fallar al intentar comprar hasta que deposites o bajes el
                      presupuesto.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    No pudimos leer tu saldo de Binance recién.
                  </p>
                  <RefreshBalanceButton
                    isRefreshing={isRefreshing}
                    onRefresh={() => startRefresh(() => router.refresh())}
                  />
                </div>
              )}
            </div>
            {strategy.modo === "dca" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="chunk">Monto por compra (USDT)</Label>
                <Input
                  id="chunk"
                  type="number"
                  min={10}
                  value={chunk}
                  onChange={(e) => setChunk(e.target.value)}
                />
              </div>
            )}
            {strategy.params.map((p) => (
              <div key={p.key} className="flex flex-col gap-2">
                <Label htmlFor={`bot-${p.key}`}>
                  {p.label.replace(" (velas)", "")}
                </Label>
                <Input
                  id={`bot-${p.key}`}
                  type="number"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={paramValues[p.key]}
                  onChange={(e) =>
                    setParamValues({ ...paramValues, [p.key]: e.target.value })
                  }
                />
                {p.enVelas && Number(paramValues[p.key]) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {paramValues[p.key]} velas de {interval}{" "}
                    {humanizeCandles(Number(paramValues[p.key]), interval)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={onActivate}
        disabled={isPending}
        size="lg"
        className="w-fit bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Activando…
          </>
        ) : (
          <>
            <Bot className="size-4" />
            {isTestnet ? "Activar el robot" : "Activar con dinero real"}
          </>
        )}
      </Button>

      <RealRiskModal
        open={riskOpen}
        onOpenChange={setRiskOpen}
        onConfirm={create}
        isPending={isPending}
      />
    </div>
  );
}
