import { roc } from "./indicators";
import type { Strategy } from "./types";

// "Envión Mensual": momentum con histéresis. Compra si el rendimiento de las
// últimas k velas supera el umbral de entrada; vende si cae bajo el de salida.
// La separación entre umbrales evita entrar y salir a cada rato.
export const rocEnvion: Strategy = {
  id: "roc-envion",
  nombre: "Envión Mensual",
  resumen:
    "Mira cuánto subió la moneda en el último mes: si subió con ganas se sube a la ola, y se baja cuando el mes se pone en rojo.",
  comoFunciona: [
    "El robot calcula cuánto subió (o bajó) la moneda en el último mes.",
    "Si subió con ganas (más que el umbral de entrada), se sube a la ola.",
    "Se queda comprado mientras el último mes siga en positivo.",
    "Si el mes se pone en rojo, se baja y espera afuera. Aviso: reacciona lento en los techos — el stop dinámico ayuda a no devolver tanto.",
  ],
  riesgo: "moderado",
  intervalo: "1d",
  modo: "allin",
  params: [
    { key: "ventana", label: "Ventana de rendimiento", min: 14, max: 90, step: 1, default: 30, enVelas: true },
    { key: "umbralEntrada", label: "Entrar si subió más de (%)", min: 0, max: 20, step: 1, default: 5 },
    { key: "umbralSalida", label: "Salir si baja de (%)", min: -10, max: 5, step: 1, default: 0 },
    { key: "stopAtr", label: "Stop de protección (× ATR, 0 = apagado)", min: 0, max: 4, step: 0.5, default: 2.5 },
    { key: "trailingAtr", label: "Stop dinámico (× ATR, 0 = apagado)", min: 0, max: 5, step: 0.5, default: 3 },
  ],
  warmup(params) {
    return Math.round(params.ventana) + 1;
  },
  signalAt(candles, i, params) {
    const k = Math.round(params.ventana);
    const entrada = params.umbralEntrada;
    const salida = Math.min(params.umbralSalida, entrada - 1);
    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const momentum = roc(closes, k)[i];
    if (momentum === null) return "hold";

    if (momentum > entrada) return "buy";
    if (momentum < salida) return "sell";
    return "hold";
  },
};
