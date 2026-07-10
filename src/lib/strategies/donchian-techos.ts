import { highestHigh, lowestLow } from "./indicators";
import type { Strategy } from "./types";

// "Rompe Techos": ruptura de canal Donchian. Compra cuando el cierre supera
// el máximo de las N velas anteriores; vende cuando cae bajo el mínimo de M.
export const donchianTechos: Strategy = {
  id: "donchian-techos",
  nombre: "Rompe Techos",
  resumen:
    "Compra cuando el precio rompe el techo de las últimas semanas y se queda hasta que pierde el piso.",
  comoFunciona: [
    "El robot marca el techo de las últimas ~3 semanas de precio.",
    "Si el precio rompe ese techo, lo interpreta como el arranque de una suba y compra.",
    "Mientras la suba siga, no toca nada.",
    "Si el precio cae por debajo del piso de las últimas ~2 semanas, vende. Aviso honesto: es normal que pierda 6 de cada 10 operaciones — gana poco seguido pero grande.",
  ],
  riesgo: "arriesgado",
  intervalo: "1d",
  modo: "allin",
  params: [
    { key: "ventanaEntrada", label: "Techo a romper (velas)", min: 10, max: 55, step: 1, default: 20, enVelas: true },
    { key: "ventanaSalida", label: "Piso de salida (velas)", min: 5, max: 20, step: 1, default: 10, enVelas: true },
    { key: "stopAtr", label: "Stop de protección (× ATR, 0 = apagado)", min: 0, max: 4, step: 0.5, default: 2.5 },
    { key: "trailingAtr", label: "Stop dinámico (× ATR, 0 = apagado)", min: 0, max: 5, step: 0.5, default: 3 },
  ],
  warmup(params) {
    return Math.round(Math.max(params.ventanaEntrada, params.ventanaSalida)) + 1;
  },
  signalAt(candles, i, params) {
    const n = Math.round(params.ventanaEntrada);
    const m = Math.round(Math.min(params.ventanaSalida, n));
    const hh = highestHigh(candles, n, i);
    const ll = lowestLow(candles, m, i);
    if (hh === null || ll === null) return "hold";

    if (candles[i].close > hh) return "buy";
    if (candles[i].close < ll) return "sell";
    return "hold";
  },
};
