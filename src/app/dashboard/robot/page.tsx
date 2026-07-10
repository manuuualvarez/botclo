import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  FlaskConical,
  KeyRound,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BotControls } from "@/components/bot/bot-controls";
import { TelegramSetup } from "@/components/telegram/telegram-setup";
import { db } from "@/db";
import { botConfigs, botTrades } from "@/db/schema";
import { isTestnet } from "@/lib/binance/client";
import { hasCredentials } from "@/lib/binance/credentials";
import { getEntitlement } from "@/lib/plan";
import { getBotInsight } from "@/lib/bot/insight";
import type { BotConfig } from "@/lib/bot/executor";
import { getStrategy, isTrendStrategy } from "@/lib/strategies";
import { getTelegramStatus } from "@/lib/telegram-settings";
import { formatAmount, formatUsd } from "@/lib/format";

export const metadata = {
  title: "Robot",
};

const dateTime = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
});

function BotCard({ bot, insight }: { bot: BotConfig; insight: string | null }) {
  const strategy = getStrategy(bot.strategyId);
  const active = bot.status === "active";
  const paramsResumen = strategy?.params
    .map((p) => {
      const value = (bot.params as Record<string, number>)[p.key] ?? p.default;
      return `${p.label.split("(")[0].trim()}: ${value}`;
    })
    .join(" · ");

  return (
    <Card className="border-white/5 bg-white/[0.02]">
      <CardContent className="pt-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">
                {strategy?.nombre ?? bot.strategyId}
              </h2>
              <Badge variant="outline" className="font-mono">
                {bot.symbol.replace("USDT", "/USDT")}
              </Badge>
              <Badge
                variant="outline"
                className={
                  active
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-white/5 text-muted-foreground"
                }
              >
                {active ? "● Activo" : "❚❚ En pausa"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Velas de {bot.interval} · {paramsResumen}
            </p>
          </div>
          <BotControls botId={bot.id} status={bot.status} />
        </div>

        {insight && (
          <p className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.05] px-4 py-3 text-sm leading-relaxed">
            <span className="font-medium text-emerald-400">
              Qué está mirando ahora:{" "}
            </span>
            {insight}
          </p>
        )}

        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Presupuesto</p>
            <p className="font-medium tabular-nums">
              {formatUsd(bot.budgetUsdt)}
              <span className="text-muted-foreground">
                {" "}
                · usado {formatUsd(bot.investedUsdt)}
              </span>
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Posición</p>
            <p className="font-medium tabular-nums">
              {bot.positionQty > 0
                ? `${formatAmount(bot.positionQty)} (prom. ${formatUsd(bot.positionAvgPrice)})`
                : "sin posición"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Stop de protección</p>
            <p className="font-medium tabular-nums">
              {bot.stopPrice ? (
                <span className="inline-flex items-center gap-1">
                  <ShieldAlert className="size-3.5 text-amber-300" />
                  {formatUsd(bot.stopPrice)}
                </span>
              ) : (
                "—"
              )}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Última revisión</p>
            <p className="font-medium">
              {bot.lastRunAt ? dateTime.format(bot.lastRunAt) : "todavía no corrió"}
              {bot.lastSignal ? (
                <span className="text-muted-foreground"> · {bot.lastSignal}</span>
              ) : null}
            </p>
          </div>
        </div>

        {bot.lastError && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="size-4" />
            <AlertTitle>Este robot encontró un problema</AlertTitle>
            <AlertDescription>{bot.lastError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export default async function RobotPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const connected = await hasCredentials(userId);
  if (!connected) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">El robot</h1>
        <Card className="mt-8 border-white/5 bg-white/[0.02]">
          <CardContent className="flex flex-col items-start gap-4 pt-2">
            <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
              <KeyRound className="size-5 text-emerald-400" />
            </span>
            <p className="text-muted-foreground">
              Para usar el robot primero tenés que conectar tu cuenta de
              Binance. Son tres pasos guiados.
            </p>
            <Button
              asChild
              className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            >
              <Link href="/dashboard/conectar">
                Conectar Binance
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const bots = await db
    .select()
    .from(botConfigs)
    .where(eq(botConfigs.userId, userId))
    .orderBy(botConfigs.createdAt);

  const telegram = await getTelegramStatus(userId);
  const maxBots = (await getEntitlement(userId)).limits.maxBots;

  if (bots.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tus robots</h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Un robot vigila un par (por ejemplo BTC/USDT) y ejecuta la
            estrategia que elijas con un presupuesto propio. Podés tener hasta
            5, cada uno con su plata y su estrategia.
          </p>
          <Button
            asChild
            size="lg"
            className="mt-6 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          >
            <Link href="/dashboard/robot/nuevo">
              <Bot className="size-4" />
              Crear mi primer robot
            </Link>
          </Button>
        </div>
        <TelegramSetup configured={telegram} />
      </div>
    );
  }

  const insights = await Promise.all(bots.map((bot) => getBotInsight(bot)));
  const trades = await db
    .select()
    .from(botTrades)
    .where(eq(botTrades.userId, userId))
    .orderBy(desc(botTrades.executedAt))
    .limit(30);

  const activeTrendBots = bots.filter(
    (b) => b.status === "active" && isTrendStrategy(b.strategyId)
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Tus robots</h1>
          {isTestnet() && (
            <Badge
              variant="outline"
              className="gap-1.5 border-amber-400/30 bg-amber-500/10 text-amber-300"
            >
              <FlaskConical className="size-3.5" />
              Modo práctica
            </Badge>
          )}
        </div>
        <Button asChild variant="outline" disabled={bots.length >= maxBots}>
          <Link href="/dashboard/robot/nuevo">
            <Plus className="size-4" />
            Agregar robot ({bots.length}/{maxBots})
          </Link>
        </Button>
      </div>

      {activeTrendBots >= 3 && (
        <Alert className="border-amber-400/30 bg-amber-500/[0.06] text-amber-200">
          <AlertTriangle className="size-4 !text-amber-300" />
          <AlertTitle>Ojo con la concentración</AlertTitle>
          <AlertDescription className="text-amber-200/80">
            Tenés {activeTrendBots} robots de tendencia activos. Las cripto
            grandes se mueven muy parecido entre sí: esto no es
            diversificación, es una sola apuesta a «cripto sube» repartida en
            cuotas. Si el mercado cae, van a caer todos juntos.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-6">
        {bots.map((bot, index) => (
          <BotCard key={bot.id} bot={bot} insight={insights[index]} />
        ))}
      </div>

      <TelegramSetup configured={telegram} />

      <div>
        <h2 className="text-xl font-semibold">Operaciones de tus robots</h2>
        {trades.length === 0 ? (
          <p className="mt-4 text-muted-foreground">
            Todavía no hay operaciones. El robot revisa el mercado cada
            minuto; cuando una estrategia dé una señal, vas a ver la operación
            acá (y en Telegram si lo configuraste).
          </p>
        ) : (
          <div className="mt-4 rounded-2xl border border-white/5 bg-white/[0.02]">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Par</TableHead>
                  <TableHead>Operación</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={trade.id} className="border-white/5">
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {dateTime.format(trade.executedAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {trade.symbol.replace("USDT", "/USDT")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          trade.side === "BUY"
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                            : "border-red-400/30 bg-red-500/10 text-red-300"
                        }
                      >
                        {trade.side === "BUY" ? "Compra" : "Venta"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(trade.qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(trade.price)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatUsd(trade.quoteQty)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {trade.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
