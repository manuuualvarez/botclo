import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { payments, subscriptions } from "@/db/schema";
import type { PaidPlanId } from "@/config/plans";
import { getPlanPrices } from "@/lib/plan-prices";
import type { MpPayment, MpPreapproval } from "@/lib/mp";
import { sendTelegramMessage } from "@/lib/telegram";
import { getTelegramCredentials } from "@/lib/telegram-settings";

// Máquina de cobranza (BUSINESS.md):
// active → (pago falla) pago_fallido → día 3 en_gracia → día 7 pausa_suave
// → día 30 cancelada. En pausa_suave el robot no abre posiciones nuevas,
// pero stops y ventas siguen activos SIEMPRE.

type Sub = typeof subscriptions.$inferSelect;

// Estado que corresponde según los días desde el primer fallo de cobro.
export function dunningStateFor(failedSince: Date, now: Date): string {
  const days = Math.floor(
    (now.getTime() - failedSince.getTime()) / 86_400_000
  );
  if (days < 3) return "pago_fallido";
  if (days < 7) return "en_gracia";
  if (days < 30) return "pausa_suave";
  return "cancelada";
}

const DUNNING_MESSAGES: Record<string, string> = {
  pago_fallido:
    "⚠️ No pudimos cobrar tu suscripción de Botclo. Vamos a reintentar; podés actualizar el medio de pago desde «Mi plan».",
  en_gracia:
    "⚠️ Tu pago sigue pendiente. En unos días tus robots van a pausar las compras nuevas (tus posiciones abiertas y sus stops siguen protegidos). Regularizalo desde «Mi plan».",
  pausa_suave:
    "⏸️ Tus robots pausaron las compras nuevas por falta de pago. Tus posiciones abiertas siguen protegidas con sus stops. Reactivá tu plan desde «Mi plan» y vuelven a operar el mismo día.",
  cancelada:
    "Tu suscripción de Botclo quedó cancelada. Tu configuración e historial se guardaron: podés reactivar cuando quieras desde «Mi plan».",
};

async function notifyBilling(userId: string, state: string) {
  const message = DUNNING_MESSAGES[state];
  if (!message) return;
  try {
    const creds = await getTelegramCredentials(userId);
    if (creds) await sendTelegramMessage(creds.token, creds.chatId, message);
  } catch {
    // el aviso nunca rompe la facturación
  }
}

// --- Aplicación de eventos de MercadoPago ---

// Pago aprobado: activa/extiende la suscripción. Idempotente por mpPaymentId.
export async function applyApprovedPayment(payment: MpPayment): Promise<void> {
  const ref = payment.external_reference ?? "";
  let userId = ref;
  let tipo: "mensual" | "anual" = "mensual";
  let plan: PaidPlanId | null = null;
  let months = 1;

  const annual = ref.match(/^(.+):anual:(real|pro)$/);
  if (annual) {
    userId = annual[1];
    tipo = "anual";
    plan = annual[2] as PaidPlanId;
    months = 12;
  }
  if (!userId) return;

  const inserted = await db
    .insert(payments)
    .values({
      userId,
      mpPaymentId: String(payment.id),
      amountArs: payment.transaction_amount,
      status: payment.status,
      tipo,
    })
    .onConflictDoNothing()
    .returning({ id: payments.id });
  if (inserted.length === 0) return; // webhook repetido: ya procesado

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  const effectivePlan =
    plan ?? ((sub?.plan as PaidPlanId | undefined) ?? "real");

  // El período nuevo arranca donde termina el vigente (si sigue vigente).
  const now = new Date();
  const base =
    sub?.currentPeriodEnd && sub.currentPeriodEnd > now
      ? sub.currentPeriodEnd
      : now;
  const end = new Date(base);
  end.setMonth(end.getMonth() + months);

  const prices = await getPlanPrices();

  // Defensa en profundidad: el monto pagado debe coincidir (±5%) con el
  // precio esperado del plan. Las preferencias se crean server-side con el
  // precio ligado al plan, así que una discrepancia grande indica
  // manipulación o un precio desactualizado — no acreditamos el período.
  const expected = prices[effectivePlan][tipo];
  const paid = payment.transaction_amount;
  if (paid > 0 && Math.abs(paid - expected) > expected * 0.05) {
    console.error(
      `[billing] monto inesperado userId=${userId} pagó=${paid} esperado=${expected} — no se acredita`
    );
    return;
  }

  const values = {
    userId,
    plan: effectivePlan,
    tipo,
    status: "active",
    amountArs: prices[effectivePlan][tipo],
    currentPeriodEnd: end,
    failedSince: null,
    lastNotifiedState: null,
    canceledAt: null,
    updatedAt: now,
  };
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

// Pago rechazado de una suscripción: arranca el reloj de cobranza.
export async function markPaymentFailed(userId: string): Promise<void> {
  if (!userId) return;
  await db
    .update(subscriptions)
    .set({ failedSince: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active")
      )
    );
}

// Evento de preapproval (alta autorizada / cancelación desde MP).
export async function applyPreapprovalEvent(
  preapproval: MpPreapproval
): Promise<void> {
  const userId = preapproval.external_reference;
  if (!userId) return;

  if (preapproval.status === "authorized") {
    // Si el pago del período todavía no llegó por webhook, damos el primer
    // mes desde la autorización (el webhook de pago luego lo extiende bien).
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });
    const periodEnd =
      sub?.currentPeriodEnd && sub.currentPeriodEnd > new Date()
        ? sub.currentPeriodEnd
        : new Date(Date.now() + 30 * 86_400_000);
    await db
      .update(subscriptions)
      .set({
        mpPreapprovalId: preapproval.id,
        status: "active",
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));
  } else if (preapproval.status === "cancelled") {
    await db
      .update(subscriptions)
      .set({
        status: "cancelada",
        canceledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));
  }
}

// --- Barrido de cobranza (lo dispara el scheduler ~1 vez por hora) ---

export async function runDunningSweep(): Promise<number> {
  const now = new Date();
  let transitions = 0;

  const subs = await db
    .select()
    .from(subscriptions)
    .where(ne(subscriptions.status, "cancelada"));

  for (const sub of subs) {
    let target: string | null = null;

    if (sub.failedSince) {
      target = dunningStateFor(sub.failedSince, now);
    } else if (
      sub.status === "active" &&
      sub.currentPeriodEnd &&
      sub.currentPeriodEnd.getTime() < now.getTime() - 2 * 86_400_000
    ) {
      // Venció el período y no llegó el pago (mensual que no renovó, o
      // anual terminado): arranca la cobranza desde el vencimiento.
      await db
        .update(subscriptions)
        .set({ failedSince: sub.currentPeriodEnd, updatedAt: now })
        .where(eq(subscriptions.userId, sub.userId));
      target = dunningStateFor(sub.currentPeriodEnd, now);
    }

    if (!target || target === sub.status) continue;

    await db
      .update(subscriptions)
      .set({
        status: target,
        canceledAt: target === "cancelada" ? now : sub.canceledAt,
        lastNotifiedState: target,
        updatedAt: now,
      })
      .where(eq(subscriptions.userId, sub.userId));
    transitions++;

    if (sub.lastNotifiedState !== target) {
      await notifyBilling(sub.userId, target);
    }
  }
  return transitions;
}

export async function getSubscription(userId: string): Promise<Sub | null> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  return sub ?? null;
}
