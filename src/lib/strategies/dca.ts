import type { Strategy } from "./types";

// DCA (compra periódica): la estrategia más simple y probada para empezar.
// Compra un monto fijo cada N velas, sin importar el precio. Nunca vende.
export const dca: Strategy = {
  id: "dca",
  nombre: "Compra periódica (DCA)",
  resumen:
    "Comprás un monto fijo cada tanto, llueva o truene. Simple, probada y sin estrés.",
  comoFunciona: [
    "Definís un presupuesto total y cada cuánto comprar (por ejemplo, una vez por semana).",
    "El sistema compra siempre el mismo monto, sin importar si el precio subió o bajó.",
    "Cuando el precio baja, tu compra rinde más unidades; cuando sube, menos. Con el tiempo, tu precio promedio se suaviza.",
    "No hay ventas: es una estrategia de acumulación a largo plazo.",
  ],
  riesgo: "conservador",
  intervalo: "1d",
  modo: "dca",
  params: [
    {
      key: "cadaNVelas",
      label: "Cada cuánto comprar",
      min: 1,
      max: 30,
      step: 1,
      default: 7, enVelas: true,
    },
  ],
  warmup() {
    return 1;
  },
  // El DCA no emite señales: su cadencia es de CALENDARIO y vive en un solo
  // lugar por lado (dcaDue en el ejecutor, el módulo `every` del backtest).
  // Una tercera implementación acá solo podría driftar en silencio.
  signalAt() {
    return "hold";
  },
};
