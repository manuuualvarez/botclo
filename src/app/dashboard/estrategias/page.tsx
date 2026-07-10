import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, FlaskConical, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfile } from "@/lib/profile";
import { isRecommendedFor, strategies } from "@/lib/strategies";
import { profileInfo } from "@/lib/quiz";
import type { RiskProfile } from "@/lib/strategies/types";

export const metadata = {
  title: "Estrategias",
};

const riskBadge: Record<RiskProfile, string> = {
  conservador: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  moderado: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  arriesgado: "border-red-400/30 bg-red-500/10 text-red-300",
};

export default async function EstrategiasPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const profile = await getProfile(userId);

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Estrategias</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
        Entrá a cualquier estrategia para ver <strong>cómo le habría ido con
        precios pasados reales</strong> (backtesting): elegís la moneda, el
        período y el capital, y simulás sin arriesgar un peso.
      </p>

      {profile ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Tu perfil es{" "}
          <span className="font-medium text-foreground">
            {profileInfo[profile].nombre.toLowerCase()}
          </span>
          : las marcadas con{" "}
          <Sparkles className="inline size-3.5 text-emerald-400" /> son las que
          mejor van con vos.
        </p>
      ) : (
        <Card className="mt-6 border-emerald-400/20 bg-emerald-500/[0.04]">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <p className="text-sm">
              Todavía no sabemos tu perfil de inversor. Son 4 preguntas y nos
              permite recomendarte estrategias a tu medida.
            </p>
            <Button
              asChild
              size="sm"
              className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            >
              <Link href="/dashboard/perfil">
                Descubrir mi perfil
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {strategies.map((strategy) => {
          const recommended =
            profile !== null && isRecommendedFor(strategy.id, profile);
          return (
            <Card
              key={strategy.id}
              className={`flex flex-col border-white/5 bg-white/[0.02] transition-colors hover:border-emerald-400/30 ${
                recommended ? "border-emerald-400/30" : ""
              }`}
            >
              <CardHeader>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={riskBadge[strategy.riesgo]}>
                    {strategy.riesgo}
                  </Badge>
                  {recommended && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                    >
                      <Sparkles className="size-3" />
                      Recomendada para vos
                    </Badge>
                  )}
                </div>
                <CardTitle>{strategy.nombre}</CardTitle>
                <CardDescription>{strategy.resumen}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/dashboard/estrategias/${strategy.id}`}>
                    <FlaskConical className="size-4" />
                    Ver cómo le fue en el pasado
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
