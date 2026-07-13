import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BotSetup } from "@/components/bot/bot-setup";
import { db } from "@/db";
import { botConfigs } from "@/db/schema";
import { getAccountBalances, isTestnet } from "@/lib/binance/client";
import { getDecryptedCredentials } from "@/lib/binance/credentials";
import { getEntitlement, plansEnforced } from "@/lib/plan";
import { strategies } from "@/lib/strategies";

export const metadata = {
  title: "Nuevo robot",
};

export default async function NuevoRobotPage({
  searchParams,
}: {
  searchParams: Promise<{ estrategia?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const creds = await getDecryptedCredentials(userId);
  if (!creds) redirect("/dashboard/conectar");

  const ent = await getEntitlement(userId);
  const existing = await db
    .select({ id: botConfigs.id })
    .from(botConfigs)
    .where(eq(botConfigs.userId, userId));
  if (existing.length >= ent.limits.maxBots) redirect("/dashboard/robot");

  // El mismo candado que aplica el server al crear (robot/actions.ts), pero
  // ANTES de mostrar el asistente: sin esto, un usuario sin plan configura
  // todo el robot y recién se entera al confirmar.
  if (plansEnforced() && (!ent.limits.modoReal || ent.sellOnly)) {
    return (
      <div className="mx-auto max-w-4xl">
        <Link
          href="/dashboard/robot"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver a mis robots
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Nuevo robot</h1>
        <Alert className="mt-8 border-amber-400/30 bg-amber-500/10">
          <Lock className="size-4" />
          <AlertTitle>
            {ent.sellOnly
              ? "Tu suscripción está en pausa por un pago pendiente"
              : "Para crear robots necesitás un plan"}
          </AlertTitle>
          <AlertDescription>
            {ent.sellOnly
              ? "No se pueden crear robots nuevos, pero tus posiciones abiertas siguen protegidas (los stops y las ventas no se cortan). Regularizá el pago y volvés a operar al instante."
              : "Los robots operan con tu dinero real de Binance: están incluidos en los planes pagos. Podés seguir usando el simulador de estrategias gratis todo lo que quieras."}
          </AlertDescription>
        </Alert>
        <Button
          asChild
          className="mt-6 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
        >
          <Link href="/dashboard/plan">
            {ent.sellOnly ? "Regularizar el pago" : "Ver planes"}
          </Link>
        </Button>
      </div>
    );
  }

  // Plan Real: solo las estrategias base para robots (Pro habilita las 8).
  const disponibles =
    plansEnforced() && ent.limits.estrategiasRobot !== null
      ? strategies.filter((s) => ent.limits.estrategiasRobot!.includes(s.id))
      : strategies;

  const { estrategia } = await searchParams;

  // Saldo disponible en USDT para los botones de porcentaje del presupuesto.
  let availableUsdt: number | null = null;
  try {
    const balances = await getAccountBalances(creds.apiKey, creds.apiSecret);
    availableUsdt = balances.find((b) => b.asset === "USDT")?.free ?? 0;
  } catch {
    availableUsdt = null;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/dashboard/robot"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a mis robots
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Nuevo robot</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
        Elegí una estrategia, un par y un presupuesto propio para este robot.
        Tres pasos y queda andando.
      </p>
      <div className="mt-10">
        {disponibles.length < strategies.length && (
          <Alert className="mb-6 border-white/10 bg-white/[0.03]">
            <Lock className="size-4" />
            <AlertTitle>Tu plan incluye las estrategias base</AlertTitle>
            <AlertDescription>
              Con Botclo Pro se habilitan las {strategies.length} estrategias
              para robots. En el simulador podés probarlas todas igual.
            </AlertDescription>
          </Alert>
        )}
        <BotSetup
          strategies={disponibles.map((s) => ({
            id: s.id,
            nombre: s.nombre,
            resumen: s.resumen,
            modo: s.modo,
            intervalo: s.intervalo,
            params: s.params,
          }))}
          initialStrategyId={estrategia}
          isTestnet={isTestnet()}
          availableUsdt={availableUsdt}
        />
      </div>
    </div>
  );
}
