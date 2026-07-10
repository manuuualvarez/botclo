import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BacktestLab } from "@/components/backtest/backtest-lab";
import { getStrategy } from "@/lib/strategies";
import type { RiskProfile } from "@/lib/strategies/types";

const riskBadge: Record<RiskProfile, string> = {
  conservador: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  moderado: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  arriesgado: "border-red-400/30 bg-red-500/10 text-red-300",
};

export default async function EstrategiaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const strategy = getStrategy(id);
  if (!strategy) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/dashboard/estrategias"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Todas las estrategias
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {strategy.nombre}
        </h1>
        <Badge variant="outline" className={riskBadge[strategy.riesgo]}>
          {strategy.riesgo}
        </Badge>
      </div>
      <p className="mt-3 text-lg text-muted-foreground">{strategy.resumen}</p>

      <Card className="mt-8 border-white/5 bg-white/[0.02]">
        <CardContent className="pt-2">
          <h2 className="mb-4 text-lg font-semibold">¿Cómo funciona?</h2>
          <ol className="flex flex-col gap-3">
            {strategy.comoFunciona.map((paso, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400 ring-1 ring-emerald-400/25">
                  {index + 1}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {paso}
                </p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="mt-8">
        <BacktestLab
          strategyId={strategy.id}
          params={strategy.params}
          intervalo={strategy.intervalo}
        />
      </div>

      <Card className="mt-8 border-white/5 bg-white/[0.02]">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Bot className="size-5 text-emerald-400" />
              ¿Te convenció?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Poné esta estrategia a trabajar con el robot, primero en modo
              práctica.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/dashboard/robot/nuevo?estrategia=${strategy.id}`}>
              Configurar el robot
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
