import { dca } from "./dca";
import { smaCross } from "./sma-cross";
import { rsiReversion } from "./rsi-reversion";
import { macdOla } from "./macd-ola";
import { bollingerRebote } from "./bollinger-rebote";
import { donchianTechos } from "./donchian-techos";
import { rocEnvion } from "./roc-envion";
import { pullbackRecorte } from "./pullback-recorte";
import type { Candle, RiskProfile, Signal, Strategy } from "./types";

export const strategies: Strategy[] = [
  dca,
  pullbackRecorte,
  smaCross,
  macdOla,
  rocEnvion,
  donchianTechos,
  rsiReversion,
  bollingerRebote,
];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find((s) => s.id === id);
}

// Qué estrategias recomendamos para cada perfil de inversor.
const RECOMMENDATIONS: Record<RiskProfile, string[]> = {
  conservador: ["dca", "pullback-recorte"],
  moderado: ["dca", "sma-cross", "macd-ola", "roc-envion"],
  arriesgado: ["macd-ola", "donchian-techos", "rsi-reversion", "bollinger-rebote"],
};

export function isRecommendedFor(
  strategyId: string,
  profile: RiskProfile
): boolean {
  return RECOMMENDATIONS[profile].includes(strategyId);
}

export function defaultParams(strategy: Strategy): Record<string, number> {
  return Object.fromEntries(strategy.params.map((p) => [p.key, p.default]));
}

// Ventana canónica de evaluación de señales. Los indicadores recursivos
// (EMA, RSI de Wilder) dependen del largo de la serie: evaluar la misma vela
// con distinta cantidad de historia puede dar señales distintas. Para que el
// backtest (toda la historia) y el ejecutor (una ventana descargada) decidan
// EXACTAMENTE igual, ambos evalúan signalAt sobre estas últimas velas.
export const SIGNAL_BUFFER = 60;

export function signalWindow(
  strategy: Strategy,
  params: Record<string, number>
): number {
  return strategy.warmup(params) + SIGNAL_BUFFER;
}

// Única puerta de entrada a signalAt para el backtest y el ejecutor.
export function evalSignal(
  strategy: Strategy,
  candles: Candle[],
  i: number,
  params: Record<string, number>
): Signal {
  if (strategy.modo === "dca") {
    // La cadencia del DCA es de calendario, no de señal: pasarla por acá
    // remaparía el índice a la ventana y rompería en silencio. Que falle
    // fuerte.
    throw new Error("evalSignal no aplica a estrategias DCA (modo calendario)");
  }
  const w = signalWindow(strategy, params);
  const start = i + 1 - w;
  if (start <= 0) return strategy.signalAt(candles, i, params);
  return strategy.signalAt(candles.slice(start, i + 1), w - 1, params);
}

// Estrategias "de tendencia": si hay 3 o más robots activos con ellas sobre
// pares cripto (muy correlacionados entre sí), avisamos que no es
// diversificación sino una sola apuesta en cuotas.
const TREND_STRATEGIES = new Set([
  "sma-cross",
  "macd-ola",
  "roc-envion",
  "donchian-techos",
]);

export function isTrendStrategy(strategyId: string): boolean {
  return TREND_STRATEGIES.has(strategyId);
}
