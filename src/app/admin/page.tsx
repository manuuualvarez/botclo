import { clerkClient } from "@clerk/nextjs/server";
import { count, eq, gte, sql } from "drizzle-orm";
import {
  Bot,
  KeyRound,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { isAdmin } from "@/lib/admin";
import {
  binanceCredentials,
  botConfigs,
  botTrades,
  grants,
  subscriptions,
  userProfiles,
} from "@/db/schema";
import { isTestnet } from "@/lib/binance/client";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Admin",
};

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card className="border-white/5 bg-white/[0.02]">
      <CardContent className="pt-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4 text-violet-400" />
          {label}
        </div>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
        {detail && (
          <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminPage() {
  // Authz en la propia página: no confiar solo en el layout (una request RSC
  // dirigida al segmento de la página puede saltearlo).
  if (!(await isAdmin())) notFound();

  const client = await clerkClient();

  const [
    totalUsers,
    [connected],
    [activeBots],
    [pausedBots],
    [trades],
    [trades24h],
    profiles,
    activeSubs,
    activeGrantRows,
  ] = await Promise.all([
    client.users.getCount(),
    db.select({ n: count() }).from(binanceCredentials),
    db.select({ n: count() }).from(botConfigs).where(eq(botConfigs.status, "active")),
    db.select({ n: count() }).from(botConfigs).where(eq(botConfigs.status, "paused")),
    db.select({ n: count() }).from(botTrades),
    db
      .select({ n: count() })
      .from(botTrades)
      .where(gte(botTrades.executedAt, sql`now() - interval '24 hours'`)),
    db
      .select({ profile: userProfiles.riskProfile, n: count() })
      .from(userProfiles)
      .groupBy(userProfiles.riskProfile)
      .orderBy(sql`count(*) desc`),
    db.select().from(subscriptions).where(eq(subscriptions.status, "active")),
    db.select().from(grants).where(eq(grants.revoked, false)),
  ]);

  const perfilResumen =
    profiles.length > 0
      ? profiles.map((p) => `${p.n} ${p.profile}`).join(" · ")
      : "sin perfiles todavía";

  // MRR = suscripciones activas (anuales prorrateadas /12); grants excluidos.
  const mrrArs = activeSubs.reduce(
    (sum, s) => sum + (s.tipo === "anual" ? s.amountArs / 12 : s.amountArs),
    0
  );
  const now = new Date();
  const activeGrants = activeGrantRows.filter(
    (g) => g.vence === null || g.vence > now
  ).length;
  const arsFmt = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Resumen del negocio
        </h1>
        <Badge
          variant="outline"
          className={
            isTestnet()
              ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
              : "border-red-400/30 bg-red-500/10 text-red-300"
          }
        >
          Plataforma en {isTestnet() ? "modo práctica" : "MODO REAL"}
        </Badge>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          icon={Users}
          label="Usuarios registrados"
          value={String(totalUsers)}
          detail={perfilResumen}
        />
        <Metric
          icon={KeyRound}
          label="Cuentas Binance conectadas"
          value={String(connected.n)}
          detail={
            totalUsers > 0
              ? `${Math.round((connected.n / totalUsers) * 100)}% de activación`
              : undefined
          }
        />
        <Metric
          icon={Bot}
          label="Robots activos"
          value={String(activeBots.n)}
          detail={`${pausedBots.n} en pausa`}
        />
        <Metric
          icon={TrendingUp}
          label="Operaciones ejecutadas"
          value={String(trades.n)}
          detail={`${trades24h.n} en las últimas 24 h`}
        />
        <Metric
          icon={Wallet}
          label="Ingresos (MRR)"
          value={arsFmt.format(mrrArs)}
          detail="Anuales prorrateados /12 · cortesías excluidas"
        />
        <Metric
          icon={Receipt}
          label="Suscripciones activas"
          value={String(activeSubs.length)}
          detail={`${activeGrants} cortesía${activeGrants === 1 ? "" : "s"} vigente${activeGrants === 1 ? "" : "s"} (cap sugerido: 15% de la base paga)`}
        />
      </div>

      <p className="text-xs text-muted-foreground/70">
        El modelo de negocios y sus métricas están definidos en BUSINESS.md.
        Churn y conversión práctica→pago se calculan cuando haya historial de
        suscripciones suficiente.
      </p>
    </div>
  );
}
