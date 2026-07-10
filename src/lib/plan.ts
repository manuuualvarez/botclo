import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { grants, subscriptions } from "@/db/schema";
import {
  PLAN_LIMITS,
  planRank,
  type PlanId,
  type PlanLimits,
} from "@/config/plans";

// Resolución del plan efectivo de un usuario:
//   max(suscripción con acceso, grant vigente), si no → free.
// "sellOnly" implementa la pausa suave de BUSINESS.md: el robot no abre
// posiciones nuevas, pero stops y ventas siguen funcionando.

export interface Entitlement {
  plan: PlanId;
  limits: PlanLimits;
  source: "subscription" | "grant" | "free" | "admin";
  sellOnly: boolean;
  subscriptionStatus: string | null;
  grantVence: Date | null;
}

interface SubLike {
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
}

interface GrantLike {
  plan: string;
  vence: Date | null;
  revoked: boolean;
}

// Núcleo puro (testeable sin DB).
export function resolvePlan(
  sub: SubLike | null,
  grantList: GrantLike[],
  now: Date
): Omit<Entitlement, "limits"> {
  // Mejor grant vigente
  let grantPlan: PlanId | null = null;
  let grantVence: Date | null = null;
  for (const g of grantList) {
    if (g.revoked) continue;
    if (g.vence !== null && g.vence.getTime() <= now.getTime()) continue;
    const plan = g.plan as PlanId;
    if (grantPlan === null || planRank(plan) > planRank(grantPlan)) {
      grantPlan = plan;
      grantVence = g.vence;
    }
  }

  // Suscripción con acceso: activa, en cobranza fallida/gracia (servicio
  // intacto), en pausa suave (acceso con restricción), o cancelada pero con
  // período ya pagado vigente.
  let subPlan: PlanId | null = null;
  let subSellOnly = false;
  if (sub) {
    const paidThrough =
      sub.currentPeriodEnd !== null &&
      sub.currentPeriodEnd.getTime() > now.getTime();
    if (["active", "pago_fallido", "en_gracia"].includes(sub.status)) {
      subPlan = sub.plan as PlanId;
    } else if (sub.status === "pausa_suave") {
      subPlan = sub.plan as PlanId;
      subSellOnly = true;
    } else if (sub.status === "cancelada" && paidThrough) {
      subPlan = sub.plan as PlanId;
    }
  }

  // El grant vigente siempre levanta la restricción de pausa suave.
  if (grantPlan !== null && (subPlan === null || planRank(grantPlan) >= planRank(subPlan))) {
    return {
      plan: grantPlan,
      source: "grant",
      sellOnly: false,
      subscriptionStatus: sub?.status ?? null,
      grantVence,
    };
  }
  if (subPlan !== null) {
    return {
      plan: subPlan,
      source: "subscription",
      sellOnly: subSellOnly,
      subscriptionStatus: sub?.status ?? null,
      grantVence: null,
    };
  }
  return {
    plan: "free",
    source: "free",
    sellOnly: false,
    subscriptionStatus: sub?.status ?? null,
    grantVence: null,
  };
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const [sub, grantList] = await Promise.all([
    db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    }),
    db
      .select()
      .from(grants)
      .where(and(eq(grants.userId, userId), eq(grants.revoked, false))),
  ]);
  const resolved = resolvePlan(sub ?? null, grantList, new Date());
  return { ...resolved, limits: PLAN_LIMITS[resolved.plan] };
}
