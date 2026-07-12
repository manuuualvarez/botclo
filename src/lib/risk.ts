import { atr } from "@/lib/strategies/indicators";
import type { Candle } from "@/lib/strategies/types";

// Overlay de riesgo compartido por el backtest y el ejecutor. Una sola
// implementación: si los stops del simulador y del robot en vivo divergen,
// es un bug — por eso viven acá y no copiados en cada lado.

export const ATR_PERIOD = 14;
// El ATR de Wilder es recursivo: su valor depende del largo de la serie.
// Se calcula SIEMPRE sobre esta misma ventana de velas para que el backtest
// (que tiene toda la historia) y el ejecutor (que baja una ventana) obtengan
// exactamente el mismo número.
export const ATR_WINDOW = ATR_PERIOD * 10;
export const STOP_MIN_PCT = 0.03; // el stop nunca más cerca que 3%…
export const STOP_MAX_PCT = 0.2; // …ni más lejos que 20% del precio de entrada
export const STOP_FALLBACK_PCT = 0.08; // sin ATR disponible: 8% fijo

// ATR en la vela i, calculado sobre la ventana canónica que termina en i.
export function atrAt(candles: Candle[], i: number): number | null {
  const start = Math.max(0, i + 1 - ATR_WINDOW);
  const series = atr(candles.slice(start, i + 1), ATR_PERIOD);
  return series[series.length - 1] ?? null;
}

// Stop inicial por ATR al abrir posición, acotado. Si el usuario pidió stop,
// SIEMPRE hay stop: sin ATR se usa el fallback fijo.
export function initialStop(
  fillPrice: number,
  atrNow: number | null,
  stopMult: number
): number | null {
  if (stopMult <= 0) return null;
  const distPct =
    atrNow !== null
      ? Math.min(
          STOP_MAX_PCT,
          Math.max(STOP_MIN_PCT, (stopMult * atrNow) / fillPrice)
        )
      : STOP_FALLBACK_PCT;
  return fillPrice * (1 - distPct);
}

// Trailing chandelier: acompaña al máximo cierre hacia arriba y JAMÁS baja.
export function trailedStop(
  current: number | null,
  highestClose: number,
  atrNow: number | null,
  trailMult: number
): number | null {
  if (trailMult <= 0 || atrNow === null) return current;
  return Math.max(current ?? -Infinity, highestClose - trailMult * atrNow);
}
