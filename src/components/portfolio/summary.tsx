import { ArrowDownRight, ArrowUpRight, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatPct, formatTime, formatUsd } from "@/lib/format";
import type { PortfolioSummary } from "@/lib/binance/portfolio";

function Delta({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${
        up ? "text-emerald-400" : "text-red-400"
      }`}
    >
      <Icon className="size-4" aria-hidden />
      {formatPct(value)}
    </span>
  );
}

export function PortfolioSummaryCards({
  portfolio,
}: {
  portfolio: PortfolioSummary;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {portfolio.isTestnet && (
          <Badge
            variant="outline"
            className="gap-1.5 border-amber-400/30 bg-amber-500/10 text-amber-300"
          >
            <FlaskConical className="size-3.5" />
            Modo práctica — fondos ficticios del testnet
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">
          Actualizado a las {formatTime(portfolio.fetchedAt)} (hora argentina)
        </span>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <Card className="border-white/5 bg-white/[0.02] sm:col-span-2">
          <CardContent className="pt-2">
            <p className="text-sm text-muted-foreground">
              Valor total de tu cartera
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tight">
              {formatUsd(portfolio.totalValueUsd)}
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="border-white/5 bg-white/[0.02]">
            <CardContent className="pt-2">
              <p className="text-sm text-muted-foreground">Últimas 24 horas</p>
              <p className="mt-1 text-2xl">
                <Delta value={portfolio.change24hPct} />
              </p>
            </CardContent>
          </Card>
          <Card className="border-white/5 bg-white/[0.02]">
            <CardContent className="pt-2">
              <p className="text-sm text-muted-foreground">Activos</p>
              <p className="mt-1 text-2xl font-semibold">
                {portfolio.holdings.length}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
