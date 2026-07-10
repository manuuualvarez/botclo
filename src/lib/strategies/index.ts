import { dca } from "./dca";
import { smaCross } from "./sma-cross";
import { rsiReversion } from "./rsi-reversion";
import { macdOla } from "./macd-ola";
import { bollingerRebote } from "./bollinger-rebote";
import { donchianTechos } from "./donchian-techos";
import { rocEnvion } from "./roc-envion";
import { pullbackRecorte } from "./pullback-recorte";
import type { RiskProfile, Strategy } from "./types";

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
