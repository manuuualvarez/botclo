import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { BotSetup } from "@/components/bot/bot-setup";
import { db } from "@/db";
import { botConfigs } from "@/db/schema";
import { getAccountBalances, isTestnet } from "@/lib/binance/client";
import { getDecryptedCredentials } from "@/lib/binance/credentials";
import { getEntitlement } from "@/lib/plan";
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

  const maxBots = (await getEntitlement(userId)).limits.maxBots;
  const existing = await db
    .select({ id: botConfigs.id })
    .from(botConfigs)
    .where(eq(botConfigs.userId, userId));
  if (existing.length >= maxBots) redirect("/dashboard/robot");

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
        <BotSetup
          strategies={strategies.map((s) => ({
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
