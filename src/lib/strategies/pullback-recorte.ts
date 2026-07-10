import { ema, rsi } from "./indicators";
import type { Strategy } from "./types";

// "Comprá el Recorte": pullback dentro de tendencia alcista. Solo opera si el
// precio está sobre la EMA de largo plazo; compra cuando el RSI se recupera
// de un recorte y vende cuando se recalienta o la tendencia se da vuelta.
export const pullbackRecorte: Strategy = {
  id: "pullback-recorte",
  nombre: "Comprá el Recorte",
  resumen:
    "Solo opera en mercados alcistas: espera un retroceso, compra cuando parece terminar y vende cuando el precio se recalienta.",
  comoFunciona: [
    "El robot solo opera si la moneda está en tendencia alcista de largo plazo.",
    "Dentro de esa suba, espera un retroceso — un «recorte» del precio.",
    "Compra cuando el recorte parece terminar (el termómetro RSI se recupera).",
    "Vende cuando el precio se recalienta, o si la tendencia grande se da vuelta. En mercados bajistas largos puede pasar meses sin operar: es a propósito.",
  ],
  riesgo: "conservador",
  intervalo: "4h",
  modo: "allin",
  params: [
    { key: "emaTendencia", label: "EMA de tendencia (velas)", min: 100, max: 300, step: 10, default: 200, enVelas: true },
    { key: "periodoRsi", label: "Período del RSI (velas)", min: 7, max: 21, step: 1, default: 14, enVelas: true },
    { key: "rsiEntrada", label: "Comprar cuando el RSI recupera", min: 25, max: 45, step: 1, default: 40 },
    { key: "rsiSalida", label: "Vender cuando el RSI supera", min: 55, max: 80, step: 1, default: 65 },
    { key: "stopAtr", label: "Stop de protección (× ATR, 0 = apagado)", min: 0, max: 4, step: 0.5, default: 2.5 },
    { key: "trailingAtr", label: "Stop dinámico (× ATR, 0 = apagado)", min: 0, max: 5, step: 0.5, default: 0 },
  ],
  warmup(params) {
    return Math.round(params.emaTendencia) + 2;
  },
  signalAt(candles, i, params) {
    const trendPeriod = Math.round(params.emaTendencia);
    const rsiPeriod = Math.round(params.periodoRsi);
    if (i < trendPeriod + 1) return "hold";

    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const trend = ema(closes, trendPeriod)[i];
    const values = rsi(closes, rsiPeriod);
    const now = values[i];
    const prev = values[i - 1];
    if (trend === null || now === null || prev === null) return "hold";

    // Tendencia dada vuelta o RSI recalentado: afuera.
    if (closes[i] < trend) return "sell";
    if (now > params.rsiSalida) return "sell";

    // Recorte que se recupera, con la tendencia a favor: adentro.
    if (prev < params.rsiEntrada && now >= params.rsiEntrada) return "buy";
    return "hold";
  },
};
