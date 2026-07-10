import { clerkClient } from "@clerk/nextjs/server";
import { count } from "drizzle-orm";
import { CheckCircle2, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { notFound } from "next/navigation";
import { GrantControls } from "@/components/admin/grant-controls";
import { isAdmin } from "@/lib/admin";
import { db } from "@/db";
import {
  binanceCredentials,
  botConfigs,
  botTrades,
  grants,
  subscriptions,
  userProfiles,
} from "@/db/schema";
import { PLAN_LIMITS } from "@/config/plans";
import { resolvePlan } from "@/lib/plan";
import { eq } from "drizzle-orm";

export const metadata = {
  title: "Usuarios — Admin",
};

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
});

export default async function AdminUsuariosPage() {
  if (!(await isAdmin())) notFound();

  const client = await clerkClient();
  const { data: users, totalCount } = await client.users.getUserList({
    limit: 100,
    orderBy: "-created_at",
  });

  // Datos de la app agregados por usuario (una query por tabla, no por usuario).
  const [connectedRows, profileRows, botRows, tradeRows, subRows, grantRows] =
    await Promise.all([
      db.select({ userId: binanceCredentials.userId }).from(binanceCredentials),
      db
        .select({ userId: userProfiles.userId, profile: userProfiles.riskProfile })
        .from(userProfiles),
      db
        .select({ userId: botConfigs.userId, status: botConfigs.status, n: count() })
        .from(botConfigs)
        .groupBy(botConfigs.userId, botConfigs.status),
      db
        .select({ userId: botTrades.userId, n: count() })
        .from(botTrades)
        .groupBy(botTrades.userId),
      db.select().from(subscriptions),
      db.select().from(grants).where(eq(grants.revoked, false)),
    ]);

  const connected = new Set(connectedRows.map((r) => r.userId));
  const profileBy = new Map(profileRows.map((r) => [r.userId, r.profile]));
  const botsBy = new Map<string, { active: number; total: number }>();
  for (const row of botRows) {
    const entry = botsBy.get(row.userId) ?? { active: 0, total: 0 };
    entry.total += row.n;
    if (row.status === "active") entry.active += row.n;
    botsBy.set(row.userId, entry);
  }
  const tradesBy = new Map(tradeRows.map((r) => [r.userId, r.n]));
  const subBy = new Map(subRows.map((r) => [r.userId, r]));
  const grantsBy = new Map<string, typeof grantRows>();
  for (const g of grantRows) {
    grantsBy.set(g.userId, [...(grantsBy.get(g.userId) ?? []), g]);
  }
  const now = new Date();

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        Usuarios{" "}
        <span className="text-base font-normal text-muted-foreground">
          ({totalCount} en total, mostrando hasta 100)
        </span>
      </h1>

      <div className="mt-6 rounded-2xl border border-white/5 bg-white/[0.02]">
        <Table>
          <TableHeader>
            <TableRow className="border-white/5 hover:bg-transparent">
              <TableHead>Usuario</TableHead>
              <TableHead>Alta</TableHead>
              <TableHead>Binance</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Robots</TableHead>
              <TableHead className="text-right">Operaciones</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const email = user.emailAddresses[0]?.emailAddress ?? "—";
              const nombre =
                [user.firstName, user.lastName].filter(Boolean).join(" ") ||
                "(sin nombre)";
              const bots = botsBy.get(user.id);
              const profile = profileBy.get(user.id);
              const ent = resolvePlan(
                subBy.get(user.id) ?? null,
                grantsBy.get(user.id) ?? [],
                now
              );
              return (
                <TableRow key={user.id} className="border-white/5">
                  <TableCell>
                    <p className="font-medium">{nombre}</p>
                    <p className="text-xs text-muted-foreground">{email}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {dateFmt.format(new Date(user.createdAt))}
                  </TableCell>
                  <TableCell>
                    {connected.has(user.id) ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                        <CheckCircle2 className="size-4" />
                        Conectado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MinusCircle className="size-4" />
                        Sin conectar
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {profile ? (
                      <Badge variant="outline">{profile}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        ent.source === "grant"
                          ? "border-violet-400/30 bg-violet-500/10 text-violet-300"
                          : ent.plan !== "free"
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                            : ""
                      }
                    >
                      {PLAN_LIMITS[ent.plan].nombre}
                      {ent.source === "grant" ? " (cortesía)" : ""}
                    </Badge>
                    {ent.source === "grant" && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ent.grantVence
                          ? `cortesía hasta ${dateFmt.format(ent.grantVence)}`
                          : "cortesía sin vencimiento"}
                      </p>
                    )}
                    {(() => {
                      const sub = subBy.get(user.id);
                      if (!sub) return null;
                      const lines: string[] = [];
                      if (sub.status === "active" && sub.currentPeriodEnd) {
                        lines.push(
                          sub.tipo === "anual"
                            ? `anual · vence ${dateFmt.format(sub.currentPeriodEnd)}`
                            : `mensual ARS ${sub.amountArs.toLocaleString("es-AR")} · próx. cobro ${dateFmt.format(sub.currentPeriodEnd)}`
                        );
                      } else if (
                        sub.status === "cancelada" &&
                        sub.currentPeriodEnd &&
                        sub.currentPeriodEnd > now
                      ) {
                        lines.push(
                          `cancelada · acceso hasta ${dateFmt.format(sub.currentPeriodEnd)}`
                        );
                      } else if (!["active", "checkout"].includes(sub.status)) {
                        lines.push(sub.status.replace("_", " "));
                      }
                      if (sub.failedSince) {
                        lines.push(`impago desde ${dateFmt.format(sub.failedSince)}`);
                      }
                      return lines.map((line) => (
                        <p
                          key={line}
                          className={`mt-0.5 text-xs ${
                            sub.failedSince || sub.status === "pausa_suave"
                              ? "text-amber-300"
                              : "text-muted-foreground"
                          }`}
                        >
                          {line}
                        </p>
                      ));
                    })()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {bots ? `${bots.active} activos / ${bots.total}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tradesBy.get(user.id) ?? 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <GrantControls
                      userId={user.id}
                      userLabel={nombre !== "(sin nombre)" ? nombre : email}
                      hasGrant={ent.source === "grant"}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground/70">
        La columna Plan muestra la suscripción o cortesía vigente con su
        próximo cobro/vencimiento. Los usuarios sin fechas están en el plan
        gratis (nada que vencer). Los precios se editan en «Planes y precios».
      </p>
    </div>
  );
}
