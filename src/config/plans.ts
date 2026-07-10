// Planes y precios de Botclo — TODO el pricing vive acá (ver BUSINESS.md).
// Cambiar un precio o un límite = editar este archivo, nada más.

export type PlanId = "free" | "real" | "pro";
export type PaidPlanId = Exclude<PlanId, "free">;

export const PLAN_PRICES_ARS: Record<
  PaidPlanId,
  { mensual: number; anual: number }
> = {
  real: { mensual: 15_000, anual: 150_000 }, // anual = 10 meses al precio de 12
  pro: { mensual: 32_000, anual: 320_000 },
};

// Estrategias habilitadas para robots REALES del plan Real (las 4 "base").
// En modo práctica y en backtesting, todas las estrategias están disponibles
// para todos los planes, siempre.
export const REAL_PLAN_STRATEGIES = [
  "dca",
  "pullback-recorte",
  "sma-cross",
  "rsi-reversion",
];

export interface PlanLimits {
  nombre: string;
  maxBots: number;
  // null = todas las estrategias para robots; lista = solo esas (modo real)
  estrategiasRobot: string[] | null;
  // null = ilimitados
  backtestsPorMes: number | null;
  // ¿puede operar robots con dinero real?
  modoReal: boolean;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    nombre: "Práctica",
    maxBots: 2,
    estrategiasRobot: null,
    backtestsPorMes: 15,
    modoReal: false,
  },
  real: {
    nombre: "Botclo Real",
    maxBots: 2,
    estrategiasRobot: REAL_PLAN_STRATEGIES,
    backtestsPorMes: null,
    modoReal: true,
  },
  pro: {
    nombre: "Botclo Pro",
    maxBots: 5,
    estrategiasRobot: null,
    backtestsPorMes: null,
    modoReal: true,
  },
};

export function planRank(plan: PlanId): number {
  return plan === "pro" ? 2 : plan === "real" ? 1 : 0;
}
