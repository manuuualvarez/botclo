import { db } from "@/db";
import { planPrices } from "@/db/schema";
import { PLAN_PRICES_ARS, type PaidPlanId } from "@/config/plans";

// Precios vigentes: DB (editable desde /admin/planes) con fallback a los
// defaults de src/config/plans.ts. Caché de 60s para no consultar en cada
// render.

export type PlanPricing = Record<PaidPlanId, { mensual: number; anual: number }>;

let cache: { at: number; value: PlanPricing } | null = null;

export async function getPlanPrices(): Promise<PlanPricing> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;

  const value: PlanPricing = {
    real: { ...PLAN_PRICES_ARS.real },
    pro: { ...PLAN_PRICES_ARS.pro },
  };
  const rows = await db.select().from(planPrices);
  for (const row of rows) {
    if (row.plan === "real" || row.plan === "pro") {
      value[row.plan] = { mensual: row.mensualArs, anual: row.anualArs };
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function setPlanPrices(
  plan: PaidPlanId,
  mensual: number,
  anual: number
): Promise<void> {
  const values = { plan, mensualArs: mensual, anualArs: anual, updatedAt: new Date() };
  await db
    .insert(planPrices)
    .values(values)
    .onConflictDoUpdate({ target: planPrices.plan, set: values });
  cache = null;
}
