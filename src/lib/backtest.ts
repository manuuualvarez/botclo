import { atr } from "./strategies/indicators";
import type { Candle, Signal, Strategy } from "./strategies/types";

// Simulador de estrategias sobre velas históricas, con overlay de riesgo.
// Reglas de honestidad (ver AGENTS.md):
// - Señales solo con velas pasadas; fill al cierre de la vela de señal ± slippage.
// - El stop se evalúa contra el LOW intra-vela (y contra gaps de apertura),
//   nunca solo contra cierres — mirar solo cierres infla los resultados.
// - Regla pesimista: ante ambigüedad intra-vela, se asume el peor caso.
// - El trailing que dispara en la vela t se calculó con datos hasta t−1.

export const BACKTEST_SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "XRP"] as const;
export type BacktestSymbol = (typeof BACKTEST_SYMBOLS)[number];

export const BACKTEST_PERIODS = [
  { value: "6m", label: "Últimos 6 meses" },
  { value: "1a", label: "Último año" },
  { value: "2a", label: "Últimos 2 años" },
] as const;

// Slippage estimado de una orden MARKET chica, por lado (además del fee).
export function slippageFor(symbol: string): number {
  return symbol.startsWith("BTC") || symbol.startsWith("ETH") ? 0.05 : 0.1;
}

const ATR_PERIOD = 14;
const STOP_MIN_PCT = 0.03; // el stop nunca más cerca que 3%…
const STOP_MAX_PCT = 0.2; // …ni más lejos que 20% del precio de entrada
const COOLDOWN_CANDLES = 1; // velas sin comprar después de un stop-out

export interface BacktestTrade {
  time: number;
  side: "buy" | "sell";
  price: number;
  qty: number;
  valueUsd: number;
  reason: string;
}

export interface EquityPoint {
  t: number;
  s: number; // valor con la estrategia
  b: number; // valor comprando y manteniendo
}

export interface BacktestResult {
  finalValueUsd: number;
  returnPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  trades: BacktestTrade[];
  numTrades: number;
  roundTrips: number;
  winRatePct: number | null;
  profitFactor: number | null; // ganancias/pérdidas de idas y vueltas cerradas
  grossProfitUsd: number; // lo que sumaron las operaciones ganadoras
  grossLossUsd: number; // lo que restaron las perdedoras
  costsUsd: number; // comisiones + slippage estimado, total
  smallSample: boolean; // menos de 30 idas y vueltas: poco confiable
  equityCurve: EquityPoint[];
  investedUsd: number;
  candlesUsed: number;
}

export interface BacktestOptions {
  initialCapitalUsd: number;
  feePct?: number; // 0.1 = comisión spot estándar de Binance
  slippagePct?: number; // por lado, según el par (slippageFor)
}

export function runBacktest(
  candles: Candle[],
  strategy: Strategy,
  params: Record<string, number>,
  options: BacktestOptions
): BacktestResult {
  const fee = (options.feePct ?? 0.1) / 100;
  const slip = (options.slippagePct ?? 0.05) / 100;
  const capital = options.initialCapitalUsd;
  const warmup = strategy.warmup(params);

  const stopMult = params.stopAtr ?? 0;
  const trailMult = params.trailingAtr ?? 0;
  const atrSeries =
    stopMult > 0 || trailMult > 0 ? atr(candles, ATR_PERIOD) : [];

  let cash = capital;
  let qty = 0;
  let stopPrice: number | null = null;
  let highestClose = 0;
  let cooldownUntil = -1;
  let costsUsd = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  // DCA: monto fijo por compra, repartiendo el capital entre las compras.
  const every =
    strategy.modo === "dca" ? Math.max(1, Math.round(params.cadaNVelas)) : 1;
  const totalBuys =
    strategy.modo === "dca"
      ? Math.max(1, Math.floor((candles.length - warmup) / every))
      : 1;
  const dcaAmount = capital / totalBuys;

  // Benchmark: comprar todo en la primera vela operable y no tocar nada.
  const benchStart =
    candles[Math.min(warmup, candles.length - 1)].close * (1 + slip);
  const benchQty = (capital * (1 - fee)) / benchStart;

  function executeBuy(i: number, spend: number, reason: string) {
    const fillPrice = candles[i].close * (1 + slip);
    const bought = (spend * (1 - fee)) / fillPrice;
    costsUsd += spend * fee + spend * slip;
    cash -= spend;
    qty += bought;
    trades.push({
      time: candles[i].closeTime,
      side: "buy",
      price: fillPrice,
      qty: bought,
      valueUsd: spend,
      reason,
    });
    // Stop inicial por ATR, acotado entre 3% y 20% de pérdida implícita.
    // Si el ATR todavía no está disponible, fallback fijo del 8%: si el
    // usuario pidió stop, SIEMPRE hay stop.
    if (stopMult > 0) {
      const atrNow = atrSeries[i];
      const distPct =
        atrNow !== null && atrNow !== undefined
          ? Math.min(
              STOP_MAX_PCT,
              Math.max(STOP_MIN_PCT, (stopMult * atrNow) / fillPrice)
            )
          : 0.08;
      stopPrice = fillPrice * (1 - distPct);
    }
    highestClose = candles[i].close;
  }

  function executeSell(i: number, price: number, reason: string) {
    const proceeds = qty * price * (1 - fee);
    // `price` ya viene con el slippage descontado; acá lo contabilizamos
    // como costo junto con la comisión.
    costsUsd += qty * price * (fee + slip);
    cash += proceeds;
    trades.push({
      time: candles[i].closeTime,
      side: "sell",
      price,
      qty,
      valueUsd: proceeds,
      reason,
    });
    qty = 0;
    stopPrice = null;
    highestClose = 0;
  }

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    if (i >= warmup) {
      // 1) Overlay de riesgo: stop contra apertura (gap) y low intra-vela,
      //    usando el stop calculado hasta la vela anterior.
      if (qty > 0 && stopPrice !== null && strategy.modo !== "dca") {
        if (candle.open <= stopPrice) {
          executeSell(i, candle.open * (1 - slip), "Stop de protección (gap)");
          cooldownUntil = i + COOLDOWN_CANDLES;
        } else if (candle.low <= stopPrice) {
          executeSell(i, stopPrice * (1 - slip), "Stop de protección");
          cooldownUntil = i + COOLDOWN_CANDLES;
        }
      }

      // 2) Si la posición sobrevivió, actualizar el trailing con la vela t.
      if (qty > 0 && trailMult > 0) {
        highestClose = Math.max(highestClose, candle.close);
        const atrNow = atrSeries[i];
        if (atrNow !== null && atrNow !== undefined) {
          const trail = highestClose - trailMult * atrNow;
          stopPrice = Math.max(stopPrice ?? -Infinity, trail);
        }
      }

      // 3) Señal de la estrategia al cierre de la vela t.
      const signal: Signal = strategy.signalAt(candles, i, params);

      if (strategy.modo === "dca") {
        if (signal === "buy" && cash > 0.01) {
          executeBuy(i, Math.min(dcaAmount, cash), "Compra periódica");
        }
      } else if (signal === "buy" && qty === 0 && cash > 0.01 && i >= cooldownUntil) {
        executeBuy(i, cash, "Señal de compra");
      } else if (signal === "sell" && qty > 0) {
        executeSell(i, candle.close * (1 - slip), "Señal de venta");
      }
    }

    equityCurve.push({
      t: candle.closeTime,
      s: cash + qty * candle.close,
      b: i >= warmup ? benchQty * candle.close : capital,
    });
  }

  const finalValueUsd = equityCurve[equityCurve.length - 1]?.s ?? capital;
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const buyHoldFinal = benchQty * lastPrice;

  // Peor caída desde un máximo (sobre la curva de la estrategia).
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.s);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, ((peak - point.s) / peak) * 100);
    }
  }

  // Idas y vueltas completas (compra→venta): win rate y factor de ganancia.
  let wins = 0;
  let roundTrips = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let entryCost: number | null = null;
  for (const trade of trades) {
    if (trade.side === "buy") {
      entryCost = trade.valueUsd;
    } else if (entryCost !== null) {
      roundTrips++;
      const pnl = trade.valueUsd - entryCost;
      if (pnl > 0) {
        wins++;
        grossProfit += pnl;
      } else {
        grossLoss += -pnl;
      }
      entryCost = null;
    }
  }

  return {
    finalValueUsd,
    returnPct: ((finalValueUsd - capital) / capital) * 100,
    buyHoldReturnPct: ((buyHoldFinal - capital) / capital) * 100,
    maxDrawdownPct: maxDrawdown,
    trades,
    numTrades: trades.length,
    roundTrips,
    winRatePct: roundTrips > 0 ? (wins / roundTrips) * 100 : null,
    profitFactor:
      roundTrips > 0 && grossLoss > 0
        ? grossProfit / grossLoss
        : roundTrips > 0 && grossProfit > 0
          ? Infinity
          : null,
    grossProfitUsd: grossProfit,
    grossLossUsd: grossLoss,
    costsUsd,
    smallSample: roundTrips > 0 && roundTrips < 30,
    equityCurve,
    investedUsd: capital,
    candlesUsed: candles.length,
  };
}
