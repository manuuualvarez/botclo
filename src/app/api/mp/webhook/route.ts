import { NextResponse } from "next/server";
import {
  applyApprovedPayment,
  applyPreapprovalEvent,
  markPaymentFailed,
} from "@/lib/billing";
import { getPayment, getPreapproval, verifyWebhookSignature } from "@/lib/mp";

// Webhook de MercadoPago. Verificamos la firma (MP_WEBHOOK_SECRET) y nunca
// confiamos en el payload: siempre re-consultamos el recurso a la API de MP.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as {
    type?: string;
    topic?: string;
    data?: { id?: string | number };
  } | null;

  const dataId =
    url.searchParams.get("data.id") ??
    (body?.data?.id !== undefined ? String(body.data.id) : null) ??
    url.searchParams.get("id");
  const type = url.searchParams.get("type") ?? body?.type ?? body?.topic ?? "";

  const valid = verifyWebhookSignature({
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
    dataId,
    nowMs: Date.now(),
  });
  if (!valid) {
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }
  if (!dataId) return NextResponse.json({ ok: true, ignored: true });

  try {
    if (type === "payment") {
      const payment = await getPayment(dataId);
      if (payment.status === "approved") {
        await applyApprovedPayment(payment);
      } else if (["rejected", "cancelled"].includes(payment.status)) {
        const ref = payment.external_reference ?? "";
        await markPaymentFailed(ref.split(":")[0]);
      }
    } else if (
      type === "subscription_preapproval" ||
      type === "preapproval"
    ) {
      const preapproval = await getPreapproval(dataId);
      await applyPreapprovalEvent(preapproval);
    }
  } catch (error) {
    // 500 → MP reintenta más tarde (queremos el reintento si falló la DB/API)
    console.error("[mp-webhook]", error);
    return NextResponse.json({ error: "reintentar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
