// Vela OHLCV tal como la devuelve Binance (klines).
export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export type Signal = "buy" | "sell" | "hold";

export type RiskProfile = "conservador" | "moderado" | "arriesgado";

export interface StrategyParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  // true si el valor se mide en velas: la UI lo traduce a tiempo real
  // ("20 velas de 1 h ≈ 20 horas") según el intervalo elegido.
  enVelas?: boolean;
}

export interface Strategy {
  id: string;
  nombre: string;
  resumen: string;
  // Explicación paso a paso, en criollo, para usuarios no técnicos.
  comoFunciona: string[];
  riesgo: RiskProfile;
  // Intervalo de vela con el que la estrategia está pensada para operar.
  intervalo: "1h" | "4h" | "1d";
  // "allin": entra y sale con todo el presupuesto según la señal.
  // "dca": compra de a cuotas fijas cada N velas y nunca vende.
  modo: "allin" | "dca";
  params: StrategyParam[];
  // Velas mínimas necesarias antes de poder emitir señal.
  warmup(params: Record<string, number>): number;
  // Señal para la vela i, usando SOLO velas 0..i (sin mirar el futuro).
  signalAt(
    candles: Candle[],
    i: number,
    params: Record<string, number>
  ): Signal;
}
