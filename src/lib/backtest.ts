import { dcaChunk } from "./bot/decisions";
import { atrAt, initialStop, trailedStop } from "./risk";
import { evalSignal } from "./strategies";
import type { Candle, Signal, Strategy } from "./strategies/types";

// Simulador de estrategias sobre velas históricas, con overlay de riesgo.
// Reglas de honestidad (ver AGENTS.md):
// - Señales solo con velas pasadas; fill al cierre de la vela de señal ± slippage.
// - La señal, los stops y el sizing usan EXACTAMENTE el mismo código y la
//   misma ventana de datos que el ejecutor en vivo (evalSignal + risk.ts):
//   lo simulado es lo que el robot va a hacer.
// - El stop se evalúa contra el LOW intra-vela (y contra gaps de apertura),
//   nunca solo contra cierres — mirar solo cierres infla los resultados.
// - Regla pesimista: ante ambigüedad intra-vela, se asume el peor caso.
// - El trailing que dispara en la vela t se calculó con datos hasta t−1.
// - Sin interés compuesto: como el robot opera con presupuesto fijo, las
//   ganancias no se reinvierten (reinvertirlas infla la curva).

export const BACKTEST_SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "XRP"] as const;
export type BacktestSymbol = (typeof BACKTEST_SYMBOLS)[number];

export const BACKTEST_PERIODS = [
  { value: "6m", label: "Últimos 6 meses", days: 182 },
  { value: "1a", label: "Último año", days: 365 },
  { value: "2a", label: "Últimos 2 años", days: 730 },
] as const;

// Slippage estimado de una orden MARKET chica, por lado (además del fee).
export function slippageFor(symbol: string): number {
  return symbol.startsWith("BTC") || symbol.startsWith("ETH") ? 0.05 : 0.1;
}

// Los stops (inicial, trailing, clamps) viven en src/lib/risk.ts — la MISMA
// implementación que usa el ejecutor en vivo.
const COOLDOWN_CANDLES = 1; // la vela del stop-out no recompra; la siguiente sí

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

  let cash = capital;
  let qty = 0;
  let stopPrice: number | null = null;
  let highestClose = 0;
  let cooldownUntil = -1;
  let costsUsd = 0;
  let peak = -Infinity;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  // DCA: la MISMA política que el robot en vivo — un monto fijo por compra
  // cada N velas hasta agotar el presupuesto (repartir el capital por todo
  // el período simularía compras que el ejecutor jamás haría).
  const every = Math.max(1, Math.round(params.cadaNVelas ?? 1));

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
    stopPrice = initialStop(fillPrice, atrAt(candles, i), stopMult);
    highestClose = fillPrice; // igual que el ejecutor: arranca en la entrada
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
        stopPrice = trailedStop(
          stopPrice,
          highestClose,
          atrAt(candles, i),
          trailMult
        );
      }

      if (strategy.modo === "dca") {
        // Calendario del DCA (no hay señal): el mismo chunk y el mismo tope
        // de presupuesto que usa el robot en vivo. dcaChunk ya acota por lo
        // que queda del presupuesto (= cash, porque el DCA nunca vende).
        if ((i - warmup) % every === 0) {
          const spend = dcaChunk(params.montoPorCompra, capital, capital - cash);
          if (spend >= 10) executeBuy(i, spend, "Compra periódica");
        }
      } else {
        // 3) Señal al cierre de la vela t, sobre la ventana canónica — la
        //    misma decisión, con los mismos datos, que toma el ejecutor.
        const signal: Signal = evalSignal(strategy, candles, i, params);

        // El robot opera con presupuesto fijo: las ganancias no se
        // reinvierten, y las pérdidas achican lo que se puede gastar
        // (misma regla que investedAfterSell en el ejecutor). Bajo 10 USD
        // el robot real tampoco compra (mínimo de Binance).
        const spend = Math.min(cash, capital);
        if (signal === "buy" && qty === 0 && spend >= 10 && i >= cooldownUntil) {
          executeBuy(i, spend, "Señal de compra");
        } else if (signal === "sell" && qty > 0) {
          executeSell(i, candle.close * (1 - slip), "Señal de venta");
        }
      }
    }

    equityCurve.push({
      t: candle.closeTime,
      s: cash + qty * candle.close,
      b: i >= warmup ? benchQty * candle.close : capital,
    });

    // Peor caída: el pico se mide sobre cierres, pero el valle considera
    // también el LOW intra-vela mientras hay posición (solo cierres la
    // subestiman).
    peak = Math.max(peak, cash + qty * candle.close);
    if (peak > 0) {
      const trough = cash + qty * candle.low;
      maxDrawdown = Math.max(maxDrawdown, ((peak - trough) / peak) * 100);
    }
  }

  const finalValueUsd = equityCurve[equityCurve.length - 1]?.s ?? capital;
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const buyHoldFinal = benchQty * lastPrice;

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
