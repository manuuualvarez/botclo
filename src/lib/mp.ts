import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaidPlanId } from "@/config/plans";

// Cliente mínimo de MercadoPago (REST, sin SDK).
// Mensual → preapproval (suscripción). Anual → preferencia de Checkout Pro
// (pago único). Webhooks firmados con MP_WEBHOOK_SECRET.

const MP_BASE = "https://api.mercadopago.com";

function accessToken(): string {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "MercadoPago no está configurado todavía (falta MP_ACCESS_TOKEN en .env)."
    );
  }
  return token;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function mpFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${MP_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "content-type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as T & {
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      `MercadoPago devolvió un error (${res.status}): ${body?.message ?? "sin detalle"}`
    );
  }
  return body;
}

// --- Suscripción mensual (preapproval) ---

export async function createMonthlyPreapproval(opts: {
  userId: string;
  payerEmail: string;
  plan: PaidPlanId;
  amountArs: number;
}): Promise<{ id: string; initPoint: string }> {
  const amount = opts.amountArs;
  const body = await mpFetch<{ id: string; init_point: string }>(
    "/preapproval",
    {
      method: "POST",
      body: {
        reason: `Botclo ${opts.plan === "pro" ? "Pro" : "Real"} — suscripción mensual`,
        external_reference: opts.userId,
        payer_email: opts.payerEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: amount,
          currency_id: "ARS",
        },
        back_url: `${appUrl()}/dashboard/plan?vuelta=1`,
        status: "pending",
      },
    }
  );
  return { id: body.id, initPoint: body.init_point };
}

export async function cancelPreapproval(preapprovalId: string): Promise<void> {
  await mpFetch(`/preapproval/${preapprovalId}`, {
    method: "PUT",
    body: { status: "cancelled" },
  });
}

export interface MpPreapproval {
  id: string;
  status: string; // pending | authorized | paused | cancelled
  external_reference: string;
  auto_recurring?: { transaction_amount?: number };
}

export async function getPreapproval(id: string): Promise<MpPreapproval> {
  return mpFetch<MpPreapproval>(`/preapproval/${id}`);
}

// --- Pago único anual (Checkout Pro) ---

export async function createAnnualPreference(opts: {
  userId: string;
  payerEmail: string;
  plan: PaidPlanId;
  amountArs: number;
}): Promise<{ id: string; initPoint: string }> {
  const amount = opts.amountArs;
  const body = await mpFetch<{ id: string; init_point: string }>(
    "/checkout/preferences",
    {
      method: "POST",
      body: {
        items: [
          {
            title: `Botclo ${opts.plan === "pro" ? "Pro" : "Real"} — plan anual (12 meses)`,
            quantity: 1,
            unit_price: amount,
            currency_id: "ARS",
          },
        ],
        // Sin `payer`: el pagador es quien se loguea en el checkout. Mandar
        // un email real acá rompe el sandbox ("both parties must be test").
        external_reference: `${opts.userId}:anual:${opts.plan}`,
        notification_url: `${appUrl()}/api/mp/webhook`,
        back_urls: {
          success: `${appUrl()}/dashboard/plan?vuelta=1`,
          pending: `${appUrl()}/dashboard/plan?vuelta=1`,
          failure: `${appUrl()}/dashboard/plan?fallo=1`,
        },
        auto_return: "approved",
      },
    }
  );
  return { id: body.id, initPoint: body.init_point };
}

export interface MpPayment {
  id: number;
  status: string; // approved | rejected | ...
  transaction_amount: number;
  external_reference?: string;
}

export async function getPayment(id: string): Promise<MpPayment> {
  return mpFetch<MpPayment>(`/v1/payments/${id}`);
}

// Búsqueda por external_reference: respaldo "pull" del webhook (clave en
// local, donde los webhooks no llegan).
export async function searchPaymentsByReference(
  externalReference: string
): Promise<MpPayment[]> {
  const body = await mpFetch<{ results: MpPayment[] }>(
    `/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc&limit=5`
  );
  return body.results ?? [];
}

// --- Verificación de firma de webhooks ---
// MP manda x-signature: "ts=...,v1=hmac" donde el manifest firmado es
// "id:{data.id};request-id:{x-request-id};ts:{ts};"

export function verifyWebhookSignature(opts: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  nowMs: number;
}): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret || !opts.xSignature || !opts.dataId) return false;

  const parts = Object.fromEntries(
    opts.xSignature.split(",").map((p) => p.trim().split("=") as [string, string])
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${opts.dataId.toLowerCase()};request-id:${opts.xRequestId ?? ""};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  // Anti-replay: rechazar notificaciones con timestamp fuera de ±10 min.
  // (Defensa extra; el handler además re-consulta a MP y es idempotente.)
  const tsMs = Number(ts) * (ts.length <= 10 ? 1000 : 1);
  if (Number.isFinite(tsMs)) {
    const skew = Math.abs(opts.nowMs - tsMs);
    if (skew > 10 * 60_000) return false;
  }
  return true;
}
