"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { payments, subscriptions } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { notifyAdmins } from "@/lib/admin-notify";
import { esArrepentimiento, getSubscription } from "@/lib/billing";
import { getPlanPrices } from "@/lib/plan-prices";
import {
  cancelPreapproval,
  createAnnualPreference,
  createMonthlyPreapproval,
} from "@/lib/mp";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";

const checkoutSchema = z.object({
  plan: z.enum(["real", "pro"]),
  tipo: z.enum(["mensual", "anual"]),
});

export interface CheckoutState {
  url?: string;
  error?: string;
  ok?: boolean;
}

export async function startCheckoutAction(input: {
  plan: string;
  tipo: string;
}): Promise<CheckoutState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };

  const limited = rateLimit(`checkout:${userId}`, {
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (!limited.ok) return { error: rateLimitMessage(limited) };

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { error: "Plan inválido." };
  const { plan, tipo } = parsed.data;

  const user = await currentUser();
  // En el sandbox de MP el pagador DEBE ser una cuenta de prueba: si
  // MP_TEST_PAYER_EMAIL está seteado, pisa el email real del usuario.
  const email =
    process.env.MP_TEST_PAYER_EMAIL ||
    user?.emailAddresses[0]?.emailAddress;
  if (!email) return { error: "Tu cuenta no tiene un email verificado." };

  try {
    const prices = await getPlanPrices();
    if (tipo === "mensual") {
      const { id, initPoint } = await createMonthlyPreapproval({
        userId,
        payerEmail: email,
        plan,
        amountArs: prices[plan].mensual,
      });
      // Fila en estado "checkout": sin acceso hasta que MP confirme el alta.
      const values = {
        userId,
        plan,
        tipo,
        status: "checkout",
        mpPreapprovalId: id,
        amountArs: prices[plan].mensual,
        updatedAt: new Date(),
      };
      await db
        .insert(subscriptions)
        .values(values)
        .onConflictDoUpdate({ target: subscriptions.userId, set: values });
      return { url: initPoint };
    }

    const { initPoint } = await createAnnualPreference({
      userId,
      payerEmail: email,
      plan,
      amountArs: prices[plan].anual,
    });
    return { url: initPoint };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "No pudimos iniciar el pago con MercadoPago.",
    };
  }
}

// Baja self-service: tan fácil como el alta (defensa del consumidor).
// El acceso ya pagado se mantiene hasta el fin del período.
export async function cancelSubscriptionAction(): Promise<CheckoutState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };

  const sub = await getSubscription(userId);
  if (!sub) return { error: "No tenés una suscripción activa." };

  try {
    if (sub.mpPreapprovalId) {
      await cancelPreapproval(sub.mpPreapprovalId).catch(() => {
        // si MP falla igual cancelamos de nuestro lado; el dunning se ocupa
      });
    }
    const ahora = new Date();
    await db
      .update(subscriptions)
      .set({
        status: "cancelada",
        canceledAt: ahora,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));

    // Aviso al ADMIN (no al usuario): si la baja cae dentro de los 10 días
    // de arrepentimiento, la ley exige devolver el total — el reintegro es
    // manual desde el panel de MercadoPago, así que Manuel tiene que
    // enterarse YA. Nunca rompe la cancelación.
    try {
      await notifyCancellationToAdmins(userId, sub, ahora);
    } catch {
      // la baja del usuario nunca depende de que el aviso salga
    }

    revalidatePath("/dashboard/plan");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No pudimos cancelar." };
  }
}

async function notifyCancellationToAdmins(
  userId: string,
  sub: NonNullable<Awaited<ReturnType<typeof getSubscription>>>,
  ahora: Date
) {
  const arrepentimiento = esArrepentimiento(sub.createdAt, ahora);
  const user = await currentUser();
  const email = user?.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId
  )?.emailAddress;

  const ultimoPago = await db.query.payments.findFirst({
    where: eq(payments.userId, userId),
    orderBy: [desc(payments.createdAt)],
  });

  const fecha = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const ars = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  });

  const quien = `${email ?? userId} (${userId})`;
  const detalle = [
    `Plan: ${sub.plan} ${sub.tipo} — ${ars.format(sub.amountArs)}`,
    `Contratada: ${fecha.format(sub.createdAt)} · Cancelada: ${fecha.format(ahora)}`,
    ultimoPago
      ? `Último pago: ${ars.format(ultimoPago.amountArs)} — mp_payment_id ${ultimoPago.mpPaymentId} (${ultimoPago.status})`
      : "Sin pagos registrados",
  ].join("\n");

  if (arrepentimiento) {
    await notifyAdmins(
      "🚨 MUY URGENTE — Arrepentimiento: hay que reintegrar",
      [
        "🚨 <b>MUY URGENTE — ARREPENTIMIENTO (Ley 24.240)</b>",
        `${quien} canceló dentro de los 10 días de contratar.`,
        "<b>HAY QUE DEVOLVER EL TOTAL</b> por el mismo medio de pago:",
        detalle,
        "Reintegro manual: panel de MercadoPago → Actividad → buscar el pago → Reembolsar.",
      ].join("\n")
    );
  } else {
    await notifyAdmins(
      "📉 Cancelación de suscripción",
      [
        "📉 <b>Cancelación de suscripción</b> (fuera de los 10 días — sin reintegro obligatorio)",
        quien,
        detalle,
        sub.currentPeriodEnd
          ? `Mantiene acceso hasta ${fecha.format(sub.currentPeriodEnd)}.`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}
