import { BUY_GRACE_CANDLES, crossWithin, rollingStd, sma } from "./indicators";
import type { Strategy } from "./types";

// "Rebote Bollinger": reversión a la media. Compra cuando el precio perforó
// la banda inferior y VOLVIÓ a entrar (confirma rebote), vende en la media.
// El stop de protección es obligatorio: sin salida propia si sigue cayendo.
export const bollingerRebote: Strategy = {
  id: "bollinger-rebote",
  nombre: "Rebote Bollinger",
  resumen:
    "Espera caídas exageradas, compra el rebote y vende cuando el precio vuelve a su zona normal.",
  comoFunciona: [
    "El precio a veces se estira demasiado para abajo, como una banda elástica.",
    "El robot espera esa caída exagerada y que el precio empiece a rebotar (no compra mientras sigue cayendo).",
    "Compra en el rebote confirmado.",
    "Vende cuando el precio vuelve a su zona normal — y si el rebote falla, el stop de protección corta la pérdida (en esta estrategia es obligatorio).",
  ],
  riesgo: "arriesgado",
  intervalo: "1h",
  modo: "allin",
  params: [
    { key: "periodo", label: "Período de las bandas (velas)", min: 10, max: 50, step: 1, default: 20, enVelas: true },
    { key: "desvios", label: "Ancho de las bandas (desvíos)", min: 1.5, max: 3, step: 0.1, default: 2 },
    { key: "stopAtr", label: "Stop de protección (× ATR)", min: 1.5, max: 4, step: 0.5, default: 2.5 },
    { key: "trailingAtr", label: "Stop dinámico (× ATR, 0 = apagado)", min: 0, max: 5, step: 0.5, default: 0 },
  ],
  warmup(params) {
    return Math.round(params.periodo) + 2;
  },
  signalAt(candles, i, params) {
    const period = Math.round(params.periodo);
    const k = params.desvios;
    if (i < period + 1) return "hold";

    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const mid = sma(closes, period);
    const std = rollingStd(closes, period);
    const midNow = mid[i];
    const stdNow = std[i];
    if (midNow === null || stdNow === null) return "hold";

    const lowerNow = midNow - k * stdNow;

    if (closes[i] >= midNow) return "sell";

    // Compra con ventana de gracia: el reingreso a la banda vale por unas
    // velas, mientras el rebote siga en pie — precio arriba de la banda
    // inferior (si volvió a perforarla, habrá un reingreso nuevo) y todavía
    // debajo de la media (garantizado por el sell de arriba).
    const crossAt = (j: number) => {
      const mj = mid[j];
      const sj = std[j];
      const mp = mid[j - 1];
      const sp = std[j - 1];
      if (mj === null || sj === null || mp === null || sp === null) return false;
      return closes[j - 1] < mp - k * sp && closes[j] > mj - k * sj;
    };
    if (closes[i] > lowerNow && crossWithin(i, BUY_GRACE_CANDLES, crossAt)) {
      return "buy";
    }
    return "hold";
  },
};
