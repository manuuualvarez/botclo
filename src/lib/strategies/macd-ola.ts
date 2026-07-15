import { BUY_GRACE_CANDLES, crossWithin, ema, macd } from "./indicators";
import type { Strategy } from "./types";

// "Ola MACD": seguimiento de tendencia. Compra en el cruce alcista del MACD
// solo si el precio está sobre la EMA de largo plazo; vende en el cruce bajista.
export const macdOla: Strategy = {
  id: "macd-ola",
  nombre: "Ola MACD",
  resumen:
    "Se sube cuando el precio agarra envión alcista en un mercado que ya viene subiendo, y se baja cuando el envión se pincha.",
  comoFunciona: [
    "El robot mira si el precio viene agarrando envión para arriba (el famoso MACD).",
    "Solo compra si además el precio está por encima de su promedio de largo plazo — o sea, en mercado alcista.",
    "Se queda comprado mientras el envión siga firme.",
    "Cuando el envión se pincha, vende todo y espera afuera. El stop de protección corta las pérdidas si algo sale mal.",
  ],
  riesgo: "moderado",
  intervalo: "4h",
  modo: "allin",
  params: [
    { key: "rapida", label: "EMA rápida (velas)", min: 5, max: 20, step: 1, default: 12, enVelas: true },
    { key: "lenta", label: "EMA lenta (velas)", min: 15, max: 50, step: 1, default: 26, enVelas: true },
    { key: "senal", label: "Señal (velas)", min: 3, max: 15, step: 1, default: 9, enVelas: true },
    { key: "filtroEma", label: "Filtro de tendencia (EMA, 0 = apagado)", min: 0, max: 300, step: 10, default: 200, enVelas: true },
    { key: "stopAtr", label: "Stop de protección (× ATR, 0 = apagado)", min: 0, max: 4, step: 0.5, default: 2.5 },
    { key: "trailingAtr", label: "Stop dinámico (× ATR, 0 = apagado)", min: 0, max: 5, step: 0.5, default: 3 },
  ],
  warmup(params) {
    return Math.max(
      Math.round(params.lenta) + Math.round(params.senal),
      Math.round(params.filtroEma)
    ) + 2;
  },
  signalAt(candles, i, params) {
    const fast = Math.round(params.rapida);
    const slow = Math.round(params.lenta);
    const sig = Math.round(params.senal);
    const filter = Math.round(params.filtroEma);
    if (fast >= slow || i < this.warmup(params)) return "hold";

    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const { line, signal } = macd(closes, fast, slow, sig);
    const now = line[i];
    const sNow = signal[i];
    if (now === null || sNow === null) return "hold";

    if (now < sNow) return "sell";

    // Compra con ventana de gracia: el cruce alcista vale por unas velas
    // mientras el MACD siga arriba de su señal y el filtro pase HOY.
    const crossAt = (j: number) => {
      const p = line[j - 1];
      const sp = signal[j - 1];
      const n = line[j];
      const sn = signal[j];
      return p !== null && sp !== null && n !== null && sn !== null && p <= sp && n > sn;
    };
    if (crossWithin(i, BUY_GRACE_CANDLES, crossAt)) {
      if (filter > 0) {
        const trend = ema(closes, filter)[i];
        if (trend === null || closes[i] <= trend) return "hold";
      }
      return "buy";
    }
    return "hold";
  },
};
