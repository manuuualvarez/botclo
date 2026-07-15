import { BUY_GRACE_CANDLES, crossWithin, sma } from "./indicators";
import type { Strategy } from "./types";

// Cruce de medias móviles: compra cuando la media corta cruza hacia arriba a
// la larga (tendencia alcista) y vende cuando cruza hacia abajo.
export const smaCross: Strategy = {
  id: "sma-cross",
  nombre: "Cruce de medias móviles",
  resumen:
    "Sigue la tendencia: compra cuando el precio arranca para arriba y se baja cuando se da vuelta.",
  comoFunciona: [
    "Se calculan dos promedios del precio: uno de los últimos días (media corta) y otro de un período más largo (media larga).",
    "Cuando la media corta cruza hacia ARRIBA a la larga, es señal de que la tendencia se volvió alcista: el sistema compra.",
    "Cuando la media corta cruza hacia ABAJO, la tendencia se enfrió: el sistema vende y se queda en dólares.",
    "Funciona bien en tendencias largas; en mercados planos puede dar señales falsas (por eso conviene probarla antes).",
  ],
  riesgo: "moderado",
  intervalo: "1d",
  modo: "allin",
  params: [
    {
      key: "corta",
      label: "Media corta (velas)",
      min: 5,
      max: 50,
      step: 1,
      default: 20, enVelas: true,
    },
    {
      key: "larga",
      label: "Media larga (velas)",
      min: 20,
      max: 200,
      step: 1,
      default: 50, enVelas: true,
    },
    { key: "stopAtr", label: "Stop de protección (× ATR, 0 = apagado)", min: 0, max: 4, step: 0.5, default: 2.5 },
    { key: "trailingAtr", label: "Stop dinámico (× ATR, 0 = apagado)", min: 0, max: 5, step: 0.5, default: 3 },
  ],
  warmup(params) {
    return Math.max(params.corta, params.larga) + 1;
  },
  signalAt(candles, i, params) {
    const short = Math.round(params.corta);
    const long = Math.round(params.larga);
    if (short >= long || i < long) return "hold";

    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const shortSma = sma(closes, short);
    const longSma = sma(closes, long);

    const sNow = shortSma[i];
    const lNow = longSma[i];
    if (sNow === null || lNow === null) return "hold";

    // Venta por NIVEL, no solo en la vela exacta del cruce: si el robot se
    // perdió esa vela (caída, orden rechazada), la señal se repite en cada
    // vela siguiente hasta que la posición salga.
    if (sNow < lNow) return "sell";

    // Compra con ventana de gracia: el cruce alcista vale por unas velas
    // mientras la media corta siga por encima de la larga.
    const crossAt = (j: number) => {
      const sp = shortSma[j - 1];
      const lp = longSma[j - 1];
      const sn = shortSma[j];
      const ln = longSma[j];
      return sp !== null && lp !== null && sn !== null && ln !== null && sp <= lp && sn > ln;
    };
    if (crossWithin(i, BUY_GRACE_CANDLES, crossAt)) return "buy";
    return "hold";
  },
};
