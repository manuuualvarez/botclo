import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Compass,
  KeyRound,
  LineChart,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AllocationChart } from "@/components/portfolio/allocation-chart";
import { EvolutionChart } from "@/components/portfolio/evolution-chart";
import { HoldingsTable } from "@/components/portfolio/holdings-table";
import { PortfolioSummaryCards } from "@/components/portfolio/summary";
import { RefreshButton } from "@/components/portfolio/refresh-button";
import { DisconnectButton } from "@/components/portfolio/disconnect-button";
import { BinanceApiError } from "@/lib/binance/client";
import { hasCredentials } from "@/lib/binance/credentials";
import {
  capturePortfolioSnapshot,
  getPortfolio,
  getSnapshots,
  type PortfolioSummary,
  type SnapshotPoint,
} from "@/lib/binance/portfolio";

export const metadata = {
  title: "Mi panel",
};

const onboardingSteps = [
  {
    icon: KeyRound,
    title: "Conectá tu Binance",
    description:
      "El primer paso: una clave para ver tu cartera. Te guiamos pantalla por pantalla.",
    cta: true,
  },
  {
    icon: LineChart,
    title: "Mirá tus rendimientos",
    description:
      "Cuando conectes tu cuenta, acá vas a ver cuánto tenés y cómo viene rindiendo.",
    cta: false,
  },
  {
    icon: Compass,
    title: "Descubrí tu estrategia",
    description:
      "Con tu perfil de inversor definido, te vamos a recomendar estrategias y podrás probarlas sin riesgo.",
    cta: false,
  },
];

function Onboarding({ nombre }: { nombre: string }) {
  return (
    <>
      <Badge
        variant="outline"
        className="mb-4 border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
      >
        Tu panel
      </Badge>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        ¡Hola, {nombre}! 👋
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
        Tu cuenta ya está creada. Esto es lo que sigue para empezar a ver tu
        cartera:
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {onboardingSteps.map((step, index) => (
          <Card key={step.title} className="border-white/5 bg-white/[0.02]">
            <CardHeader>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
                  <step.icon className="size-5 text-emerald-400" />
                </span>
                <span className="text-3xl font-bold text-white/10">
                  {index + 1}
                </span>
              </div>
              <CardTitle>{step.title}</CardTitle>
              <CardDescription>{step.description}</CardDescription>
            </CardHeader>
            {step.cta && (
              <CardContent>
                <Button
                  asChild
                  className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                >
                  <Link href="/dashboard/conectar">
                    Conectar ahora
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

function PortfolioView({
  portfolio,
  snapshots,
  error,
}: {
  portfolio: PortfolioSummary | null;
  snapshots: SnapshotPoint[];
  error: string | null;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Tu cartera
        </h1>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <DisconnectButton />
        </div>
      </div>

      {error || !portfolio ? (
        <Alert variant="destructive" className="mt-8">
          <AlertCircle className="size-4" />
          <AlertTitle>No pudimos traer tu cartera</AlertTitle>
          <AlertDescription>
            <p>{error ?? "Ocurrió un error inesperado. Probá actualizar."}</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/dashboard/conectar">Volver a conectar Binance</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          <PortfolioSummaryCards portfolio={portfolio} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-white/5 bg-white/[0.02]">
              <CardContent className="pt-2">
                <h2 className="mb-4 font-semibold">
                  ¿En qué está tu plata?
                </h2>
                <AllocationChart holdings={portfolio.holdings} />
              </CardContent>
            </Card>
            <Card className="border-white/5 bg-white/[0.02]">
              <CardContent className="pt-2">
                <h2 className="mb-4 font-semibold">
                  Evolución de tu cartera
                </h2>
                {snapshots.length >= 2 ? (
                  <EvolutionChart points={snapshots} />
                ) : (
                  <div className="flex h-52 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    Este gráfico se arma solo con el tiempo: guardamos el
                    valor de tu cartera una vez por hora. Volvé mañana y vas a
                    ver la curva.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <HoldingsTable
            holdings={portfolio.holdings}
            unpricedAssets={portfolio.unpricedAssets}
          />
        </div>
      )}
    </>
  );
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const connected = await hasCredentials(userId);

  let content: React.ReactNode;
  if (!connected) {
    const user = await currentUser();
    content = <Onboarding nombre={user?.firstName ?? "inversor"} />;
  } else {
    let portfolio: PortfolioSummary | null = null;
    let snapshots: SnapshotPoint[] = [];
    let error: string | null = null;
    try {
      portfolio = await getPortfolio(userId);
      await capturePortfolioSnapshot(userId);
      snapshots = await getSnapshots(userId);
    } catch (e) {
      error =
        e instanceof BinanceApiError
          ? e.friendlyMessage
          : "No pudimos comunicarnos con Binance en este momento. Probá actualizar en unos segundos.";
    }
    content = (
      <PortfolioView portfolio={portfolio} snapshots={snapshots} error={error} />
    );
  }

  return content;
}
