"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  getKlinesPaged,
  getTakerFeePct,
  BinanceApiError,
} from "@/lib/binance/client";
import { getDecryptedCredentials } from "@/lib/binance/credentials";
import {
  BACKTEST_PERIODS,
  BACKTEST_SYMBOLS,
  runBacktest,
  slippageFor,
  type BacktestResult,
  type EquityPoint,
} from "@/lib/backtest";
import { clampDcaChunk } from "@/lib/bot/decisions";
import { candlesPerDay } from "@/lib/intervals";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { backtestUsage } from "@/db/schema";
import { getEntitlement } from "@/lib/plan";
import { getStrategy } from "@/lib/strategies";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";

// Cuota mensual de backtests del plan gratis. Devuelve el error a mostrar,
// o null si puede simular. Aplica también a admins: para operar sin límites,
// date una cortesía desde /admin/usuarios.
async function checkBacktestQuota(userId: string): Promise<string | null> {
  const ent = await getEntitlement(userId);
  const quota = ent.limits.backtestsPorMes;
  if (quota === null) return null;

  const period = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const [row] = await db
    .insert(backtestUsage)
    .values({ userId, period, count: 1 })
    .onConflictDoUpdate({
      target: [backtestUsage.userId, backtestUsage.period],
      set: { count: sql`${backtestUsage.count} + 1` },
    })
    .returning({ count: backtestUsage.count });

  if (row.count > quota) {
    return `Alcanzaste las ${quota} simulaciones gratis de este mes. Con cualquier plan pago son ilimitadas — mirá la pestaña «Mi plan».`;
  }
  return null;
}

// El gráfico no necesita más de ~1500 puntos: para períodos largos en velas
// de 1 h serían decenas de miles — se diezma solo la curva (las métricas se
// calculan siempre sobre la serie completa).
function thinEquityCurve(curve: EquityPoint[], maxPoints = 1500): EquityPoint[] {
  if (curve.length <= maxPoints) return curve;
  const step = Math.ceil(curve.length / maxPoints);
  const out = curve.filter((_, idx) => idx % step === 0);
  if (out[out.length - 1] !== curve[curve.length - 1]) {
    out.push(curve[curve.length - 1]);
  }
  return out;
}

const PERIOD_DAYS = Object.fromEntries(
  BACKTEST_PERIODS.map((p) => [p.value, p.days])
) as Record<(typeof BACKTEST_PERIODS)[number]["value"], number>;

const inputSchema = z.object({
  strategyId: z.string(),
  symbol: z.enum(BACKTEST_SYMBOLS),
  period: z.enum(["6m", "1a", "2a"]),
  capital: z.coerce.number().min(10).max(1_000_000),
  params: z.record(z.string(), z.coerce.number()),
});

export interface RunBacktestState {
  result?: BacktestResult;
  symbol?: string;
  error?: string;
  feePct?: number;
  feePersonalizada?: boolean;
}

// Comisión taker real del usuario, cacheada 10 min (la llamada a /account
// pesa 20 en el rate limit de Binance). null → usar la estándar (0,1%).
const feeCache = new Map<string, { at: number; pct: number | null }>();

async function userTakerFeePct(userId: string): Promise<number | null> {
  const cached = feeCache.get(userId);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.pct;

  let pct: number | null = null;
  try {
    const creds = await getDecryptedCredentials(userId);
    if (creds) pct = await getTakerFeePct(creds.apiKey, creds.apiSecret);
  } catch {
    pct = null; // sin cuenta conectada o Binance caído: comisión estándar
  }
  feeCache.set(userId, { at: Date.now(), pct });
  return pct;
}

export async function runBacktestAction(
  input: unknown
): Promise<RunBacktestState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };

  // Cada simulación descarga velas de Binance: limitamos el ritmo.
  const limited = rateLimit(`backtest:${userId}`, {
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (!limited.ok) return { error: rateLimitMessage(limited) };

  const quotaError = await checkBacktestQuota(userId);
  if (quotaError) return { error: quotaError };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Revisá los valores del formulario e intentá de nuevo." };
  }

  const strategy = getStrategy(parsed.data.strategyId);
  if (!strategy) return { error: "Estrategia desconocida." };

  // Clampeamos cada parámetro a su rango declarado.
  const params: Record<string, number> = {};
  for (const def of strategy.params) {
    const raw = parsed.data.params[def.key] ?? def.default;
    params[def.key] = Math.min(def.max, Math.max(def.min, raw));
  }
  // DCA: el monto por compra se clampea con la MISMA función que al crear
  // un robot — así el laboratorio simula el chunk real.
  if (strategy.modo === "dca") {
    params.montoPorCompra = clampDcaChunk(
      parsed.data.params.montoPorCompra,
      parsed.data.capital
    );
  }

  try {
    // El período se traduce a velas del intervalo REAL de la estrategia:
    // "6 meses" de una estrategia de 1 h son ~4380 velas, no 182.
    const raw = await getKlinesPaged(
      `${parsed.data.symbol}USDT`,
      strategy.intervalo,
      PERIOD_DAYS[parsed.data.period] * candlesPerDay(strategy.intervalo) + 1
    );
    // La última vela viene en formación: se descarta, igual que el ejecutor.
    const candles = raw.slice(0, -1);
    if (candles.length < strategy.warmup(params) + 10) {
      return {
        error:
          "No hay suficiente historia de precios para este período. Probá con un período más largo.",
      };
    }
    const userFee = await userTakerFeePct(userId);
    const result = runBacktest(candles, strategy, params, {
      initialCapitalUsd: parsed.data.capital,
      feePct: userFee ?? 0.1,
      slippagePct: slippageFor(`${parsed.data.symbol}USDT`),
    });
    return {
      result: { ...result, equityCurve: thinEquityCurve(result.equityCurve) },
      symbol: parsed.data.symbol,
      feePct: userFee ?? 0.1,
      feePersonalizada: userFee !== null,
    };
  } catch (e) {
    if (e instanceof BinanceApiError) {
      return { error: `Binance no pudo darnos los datos históricos: ${e.message}` };
    }
    return {
      error:
        "No pudimos descargar los datos históricos. Revisá tu conexión e intentá de nuevo.",
    };
  }
}
