import { rsi } from "./indicators";
import type { Strategy } from "./types";

// Reversión con RSI: compra cuando el mercado está "sobrevendido" (pánico)
// y vende cuando está "sobrecomprado" (euforia).
export const rsiReversion: Strategy = {
  id: "rsi-reversion",
  nombre: "Reversión con RSI",
  resumen:
    "Compra en el pánico y vende en la euforia, usando el termómetro RSI del mercado.",
  comoFunciona: [
    "El RSI es un termómetro de 0 a 100 que mide si un activo subió o bajó demasiado rápido.",
    "Cuando el RSI cae por debajo del umbral de compra (típicamente 30), el mercado está en pánico: el sistema compra.",
    "Cuando el RSI supera el umbral de venta (típicamente 70), hay euforia: el sistema vende y toma ganancia.",
    "Es una estrategia más activa y agresiva: puede comprar mientras el precio todavía está cayendo. Probala bien en el simulador antes de usarla.",
  ],
  riesgo: "arriesgado",
  intervalo: "1d",
  modo: "allin",
  params: [
    {
      key: "periodo",
      label: "Período del RSI (velas)",
      min: 5,
      max: 30,
      step: 1,
      default: 14, enVelas: true,
    },
    {
      key: "umbralCompra",
      label: "Comprar cuando RSI baja de",
      min: 10,
      max: 45,
      step: 1,
      default: 30,
    },
    {
      key: "umbralVenta",
      label: "Vender cuando RSI supera",
      min: 55,
      max: 90,
      step: 1,
      default: 70,
    },
    { key: "stopAtr", label: "Stop de protección (× ATR, 0 = apagado)", min: 0, max: 4, step: 0.5, default: 2.5 },
    { key: "trailingAtr", label: "Stop dinámico (× ATR, 0 = apagado)", min: 0, max: 5, step: 0.5, default: 0 },
  ],
  warmup(params) {
    return Math.round(params.periodo) + 2;
  },
  signalAt(candles, i, params) {
    const period = Math.round(params.periodo);
    if (i <= period) return "hold";

    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const values = rsi(closes, period);
    const now = values[i];
    if (now === null) return "hold";

    if (now < params.umbralCompra) return "buy";
    if (now > params.umbralVenta) return "sell";
    return "hold";
  },
};
