import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Gift,
  PauseCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  CancelSubscriptionButton,
  CheckoutButtons,
} from "@/components/plan/plan-actions";
import { PLAN_LIMITS } from "@/config/plans";
import { getPlanPrices } from "@/lib/plan-prices";
import {
  applyApprovedPayment,
  applyPreapprovalEvent,
  getSubscription,
} from "@/lib/billing";
import { getPreapproval, searchPaymentsByReference } from "@/lib/mp";
import { getEntitlement } from "@/lib/plan";

export const metadata = {
  title: "Mi plan",
};

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

const FEATURES: Record<string, string[]> = {
  free: [
    "Modo práctica completo (fondos ficticios)",
    "Cartera en vivo con gráficos",
    "Las 8 estrategias explicadas",
    "15 simulaciones (backtests) por mes",
    "2 robots de práctica",
    "Avisos por Telegram",
  ],
  real: [
    "Todo lo del plan Práctica",
    "Robots con dinero real",
    "2 robots · 4 estrategias base",
    "Simulaciones ilimitadas",
  ],
  pro: [
    "Todo lo de Botclo Real",
    "5 robots · las 8 estrategias",
    "Simulaciones ilimitadas",
    "Soporte prioritario",
  ],
};

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ vuelta?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Sincronización "pull" del checkout: respaldo del webhook (imprescindible
  // en local, donde los webhooks no llegan; sano en producción también).
  // Corre SIEMPRE que no haya suscripción activa — sin depender de params.
  let sub = await getSubscription(userId);
  await searchParams; // (param `vuelta` ya no condiciona la sincronización)
  try {
    // Mensual: consultar el preapproval pendiente.
    if (sub?.status === "checkout" && sub.mpPreapprovalId) {
      await applyPreapprovalEvent(await getPreapproval(sub.mpPreapprovalId));
      sub = await getSubscription(userId);
    }
    // Anual: buscar pagos aprobados por referencia.
    if (sub?.status !== "active") {
      for (const plan of ["real", "pro"] as const) {
        const pagos = await searchPaymentsByReference(
          `${userId}:anual:${plan}`
        );
        for (const pago of pagos) {
          if (pago.status === "approved") await applyApprovedPayment(pago);
        }
      }
      sub = await getSubscription(userId);
    }
  } catch (error) {
    // Sin MP configurado o MP caído la página funciona igual, pero el error
    // queda en los logs — nunca más tragado en silencio.
    console.error("[plan-sync]", error);
  }

  const [ent, prices] = await Promise.all([
    getEntitlement(userId),
    getPlanPrices(),
  ]);

  const status = sub?.status ?? null;
  const enCobranza =
    status !== null &&
    ["pago_fallido", "en_gracia", "pausa_suave"].includes(status);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-3xl font-bold tracking-tight">Mi plan</h1>

      {/* Estado actual */}
      <Card className="mt-8 border-emerald-400/20 bg-emerald-500/[0.04]">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div>
            <p className="text-sm text-muted-foreground">Tu plan actual</p>
            <p className="flex items-center gap-2 text-2xl font-bold">
              {ent.limits.nombre}
              {ent.source === "grant" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-violet-400/30 bg-violet-500/10 text-violet-300"
                >
                  <Gift className="size-3" />
                  Cortesía
                  {ent.grantVence
                    ? ` hasta ${dateFmt.format(ent.grantVence)}`
                    : ""}
                </Badge>
              )}
            </p>
            {sub?.currentPeriodEnd && status === "active" && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {sub.tipo === "anual" ? "Válido" : "Se renueva"} hasta el{" "}
                {dateFmt.format(sub.currentPeriodEnd)}
              </p>
            )}
            {status === "cancelada" &&
              sub?.currentPeriodEnd &&
              sub.currentPeriodEnd > new Date() && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Cancelada — mantenés el acceso hasta el{" "}
                  {dateFmt.format(sub.currentPeriodEnd)}
                </p>
              )}
          </div>
          {status === "active" && <CancelSubscriptionButton />}
        </CardContent>
      </Card>

      {enCobranza && (
        <Alert
          className="mt-4 border-amber-400/30 bg-amber-500/[0.06] text-amber-200"
        >
          {status === "pausa_suave" ? (
            <PauseCircle className="size-4 !text-amber-300" />
          ) : (
            <AlertCircle className="size-4 !text-amber-300" />
          )}
          <AlertTitle>
            {status === "pausa_suave"
              ? "Tus robots pausaron las compras nuevas"
              : "Tenemos un problema con tu pago"}
          </AlertTitle>
          <AlertDescription className="text-amber-200/80">
            {status === "pausa_suave"
              ? "Por un pago pendiente, tus robots no abren posiciones nuevas — pero tus posiciones abiertas y sus stops siguen protegidos, siempre. Al regularizar el pago vuelven a operar el mismo día."
              : "No pudimos cobrar tu suscripción. Vamos a reintentar; si el problema sigue, en unos días los robots pausarán las compras nuevas (tus posiciones abiertas quedan protegidas)."}
          </AlertDescription>
        </Alert>
      )}

      {/* Planes */}
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {(["free", "real", "pro"] as const).map((planId) => {
          const limits = PLAN_LIMITS[planId];
          const esActual = ent.plan === planId;
          const destacado = planId === "real";
          return (
            <Card
              key={planId}
              className={`flex flex-col border-white/5 bg-white/[0.02] ${
                destacado ? "border-emerald-400/30" : ""
              }`}
            >
              <CardContent className="flex flex-1 flex-col gap-4 pt-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{limits.nombre}</h2>
                    {esActual && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      >
                        <BadgeCheck className="size-3" />
                        Tu plan
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-2xl font-bold">
                    {planId === "free"
                      ? "Gratis"
                      : `$${prices[planId].mensual.toLocaleString("es-AR")}`}
                    {planId !== "free" && (
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        ARS/mes
                      </span>
                    )}
                  </p>
                </div>
                <ul className="flex flex-1 flex-col gap-2">
                  {FEATURES[planId].map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                {planId !== "free" && !esActual && (
                  <CheckoutButtons
                    plan={planId}
                    mensual={prices[planId].mensual}
                    anual={prices[planId].anual}
                    destacado={destacado}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground/70">
        Los pagos se procesan con MercadoPago. Podés cancelar cuando quieras,
        con un clic, y mantenés el acceso hasta el fin del período pagado. Si
        dejás de pagar, tus robots dejan de abrir posiciones nuevas pero tus
        posiciones abiertas y sus stops siguen protegidos — nunca cerramos
        posiciones tuyas por un tema de facturación.
      </p>
    </div>
  );
}
