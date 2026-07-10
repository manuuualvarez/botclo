import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { portfolioSnapshots } from "@/db/schema";
import { getDecryptedCredentials } from "./credentials";
import { get24hTickers, getAccountBalances, isTestnet } from "./client";

// Stablecoins valuadas 1:1 con el dólar (no tienen par XXXUSDT o no hace
// falta consultarlo).
const STABLECOINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);

export interface Holding {
  asset: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
  change24hPct: number | null;
  allocationPct: number;
}

export interface PortfolioSummary {
  totalValueUsd: number;
  // Promedio de la variación 24h de cada activo, ponderado por su valor.
  change24hPct: number | null;
  holdings: Holding[];
  unpricedAssets: string[];
  isTestnet: boolean;
  fetchedAt: Date;
}

// Caché corto en memoria: navegar entre pestañas no re-consulta a Binance.
// El botón "Actualizar" trae datos frescos pasados los 10 segundos.
const CACHE_TTL_MS = 10_000;
const portfolioCache = new Map<
  string,
  { at: number; value: PortfolioSummary }
>();

export async function getPortfolio(
  userId: string
): Promise<PortfolioSummary | null> {
  const cached = portfolioCache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const creds = await getDecryptedCredentials(userId);
  if (!creds) return null;

  const balances = await getAccountBalances(creds.apiKey, creds.apiSecret);

  const symbols = balances
    .filter((b) => !STABLECOINS.has(b.asset))
    .map((b) => `${b.asset}USDT`);
  const tickers = await get24hTickers(symbols);

  const holdings: Holding[] = balances.map((b) => {
    if (STABLECOINS.has(b.asset)) {
      return {
        asset: b.asset,
        amount: b.total,
        priceUsd: 1,
        valueUsd: b.total,
        change24hPct: 0,
        allocationPct: 0,
      };
    }
    const ticker = tickers.get(`${b.asset}USDT`);
    return {
      asset: b.asset,
      amount: b.total,
      priceUsd: ticker?.lastPrice ?? null,
      valueUsd: ticker ? b.total * ticker.lastPrice : 0,
      change24hPct: ticker?.priceChangePercent ?? null,
      allocationPct: 0,
    };
  });

  const totalValueUsd = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
  for (const h of holdings) {
    h.allocationPct = totalValueUsd > 0 ? (h.valueUsd / totalValueUsd) * 100 : 0;
  }

  const priced = holdings.filter((h) => h.change24hPct !== null && h.valueUsd > 0);
  const pricedValue = priced.reduce((sum, h) => sum + h.valueUsd, 0);
  const change24hPct =
    pricedValue > 0
      ? priced.reduce(
          (sum, h) => sum + (h.change24hPct ?? 0) * (h.valueUsd / pricedValue),
          0
        )
      : null;

  holdings.sort((a, b) => b.valueUsd - a.valueUsd);

  const summary: PortfolioSummary = {
    totalValueUsd,
    change24hPct,
    holdings,
    unpricedAssets: holdings.filter((h) => h.priceUsd === null).map((h) => h.asset),
    isTestnet: isTestnet(),
    fetchedAt: new Date(),
  };
  portfolioCache.set(userId, { at: Date.now(), value: summary });
  return summary;
}

// Guarda un snapshot del valor total como máximo una vez por hora — la serie
// alimenta el gráfico "Evolución de tu cartera".
export async function capturePortfolioSnapshot(userId: string): Promise<void> {
  const [latest] = await db
    .select({ capturedAt: portfolioSnapshots.capturedAt })
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.capturedAt))
    .limit(1);
  if (latest && Date.now() - latest.capturedAt.getTime() < 60 * 60_000) return;

  const portfolio = await getPortfolio(userId);
  if (!portfolio || portfolio.totalValueUsd <= 0) return;
  await db.insert(portfolioSnapshots).values({
    userId,
    totalValueUsd: portfolio.totalValueUsd,
  });
}

export interface SnapshotPoint {
  t: number;
  v: number;
}

export async function getSnapshots(
  userId: string,
  days = 90
): Promise<SnapshotPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(portfolioSnapshots.capturedAt);
  return rows
    .filter((r) => r.capturedAt >= since)
    .map((r) => ({ t: r.capturedAt.getTime(), v: r.totalValueUsd }));
}
