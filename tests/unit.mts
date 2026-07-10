// Suite de tests de lógica pura (sin red) — corre en CI con `pnpm test:ci`.
// Cubre lo crítico: cifrado, indicadores, backtest+overlay de riesgo,
// comisiones, límite de ritmo, resolución de plan, cobranza y firma MP.
process.env.ENCRYPTION_KEY = "a".repeat(64);
process.env.BINANCE_USE_TESTNET = "true";
process.env.MP_WEBHOOK_SECRET = "secreto-test";

import { createHmac } from "node:crypto";
import { encrypt, decrypt } from "@/lib/crypto";
import { sma, rsi, ema, atr, macd, roc, rollingStd, highestHigh } from "@/lib/strategies/indicators";
import { strategies, defaultParams } from "@/lib/strategies";
import { runBacktest } from "@/lib/backtest";
import { commissionIn } from "@/lib/binance/client";
import { rateLimit } from "@/lib/rate-limit";
import { resolvePlan } from "@/lib/plan";
import { dunningStateFor } from "@/lib/billing";
import { verifyWebhookSignature } from "@/lib/mp";
import type { Candle, Strategy } from "@/lib/strategies/types";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed++;
};

// --- Cifrado ---
const secret = "mi-api-secret-1234567890";
const payload = encrypt(secret);
check("crypto roundtrip", decrypt(payload) === secret);
check("payload no contiene el texto plano", !payload.includes(secret));
check("IV aleatorio", encrypt(secret) !== payload);
let tampered = false;
try { decrypt(payload.slice(0, -4) + "AAA="); } catch { tampered = true; }
check("payload manipulado rechazado", tampered);

// --- Indicadores ---
const serie = Array.from({ length: 50 }, (_, i) => 100 + i);
check("SMA(3)", sma([1, 2, 3, 4], 3)[2] === 2);
check("EMA warmup null + crece", ema(serie, 5)[3] === null && (ema(serie, 5)[49] as number) > 100);
check("RSI=100 en subida", rsi(Array.from({ length: 30 }, (_, i) => 100 + i), 14)[29] === 100);
check("stddev serie plana = 0", rollingStd(new Array(30).fill(100), 10)[29] === 0);
check("ROC serie plana = 0", roc(new Array(30).fill(100), 10)[29] === 0);
check("MACD positivo en subida", (macd(serie, 12, 26, 9).line[49] as number) > 0);
const cndl = (i: number, o: number, h: number, l: number, c: number): Candle => ({ openTime: i * 8.64e7, open: o, high: h, low: l, close: c, volume: 1, closeTime: (i + 1) * 8.64e7 - 1 });
const flatC = Array.from({ length: 30 }, (_, i) => cndl(i, 100, 102, 98, 100));
check("ATR de rango constante ≈ 4", Math.abs((atr(flatC, 14)[29] as number) - 4) < 0.5);
check("Donchian excluye vela actual", highestHigh(flatC, 10, 20) === 102);

// --- Comisiones ---
const fills = [{ commission: "0.001", commissionAsset: "BTC" }, { commission: "1.25", commissionAsset: "USDT" }];
check("comisión en BTC", Math.abs(commissionIn(fills, "BTC") - 0.001) < 1e-9);
check("comisión BNB no afecta otros", commissionIn(fills, "ETH") === 0);

// --- Backtest + overlay de riesgo (velas sintéticas) ---
const buyAt5: Strategy = {
  id: "t", nombre: "t", resumen: "", comoFunciona: [], riesgo: "moderado", intervalo: "1d", modo: "allin",
  params: [{ key: "stopAtr", label: "", min: 0, max: 10, step: 0.5, default: 2.5 }, { key: "trailingAtr", label: "", min: 0, max: 10, step: 0.5, default: 0 }],
  warmup: () => 3, signalAt: (_c, i) => (i === 5 ? "buy" : "hold"),
};
const stopC: Candle[] = [];
for (let i = 0; i < 8; i++) stopC.push(cndl(i, 100, 102, 98, 100));
stopC.push(cndl(8, 100, 101, 80, 99));
for (let i = 9; i < 14; i++) stopC.push(cndl(i, 99, 101, 97, 99));
const stopR = runBacktest(stopC, buyAt5, { stopAtr: 2.5, trailingAtr: 0 }, { initialCapitalUsd: 1000, slippagePct: 0 });
const stopSell = stopR.trades.find((t) => t.side === "sell");
check("stop salta con el low intra-vela", stopSell !== undefined && stopSell.price > 80 && stopSell.price < 100);
check("comisión menor → menos costos", runBacktest(stopC, buyAt5, { stopAtr: 2.5, trailingAtr: 0 }, { initialCapitalUsd: 1000, feePct: 0.075 }).costsUsd < runBacktest(stopC, buyAt5, { stopAtr: 2.5, trailingAtr: 0 }, { initialCapitalUsd: 1000, feePct: 0.1 }).costsUsd);

// Cada estrategia real corre sana sobre velas sintéticas (sin red)
const synth: Candle[] = Array.from({ length: 400 }, (_, i) => {
  const p = 100 + 30 * Math.sin(i / 20) + i * 0.1;
  return cndl(i, p - 1, p + 2, p - 2, p);
});
for (const s of strategies) {
  const r = runBacktest(synth, s, defaultParams(s), { initialCapitalUsd: 500, slippagePct: 0.05 });
  check(`backtest sano: ${s.id}`, r.finalValueUsd > 0 && r.equityCurve.length === 400 && r.maxDrawdownPct >= 0 && r.maxDrawdownPct <= 100);
  const i = 300;
  const before = s.signalAt(synth, i, defaultParams(s));
  const mut = synth.map((c, j) => (j > i ? { ...c, close: c.close * 3, high: c.high * 3, low: c.low * 3 } : c));
  check(`sin look-ahead: ${s.id}`, before === s.signalAt(mut, i, defaultParams(s)));
}

// --- Rate limit ---
const o = { limit: 2, windowMs: 60_000 };
check("rate limit permite y bloquea", rateLimit("x", o).ok && rateLimit("x", o).ok && !rateLimit("x", o).ok);
check("rate limit por clave", rateLimit("y", o).ok);

// --- Resolución de plan ---
const now = new Date("2026-07-10T12:00:00Z");
const fut = new Date("2026-12-01");
const past = new Date("2026-07-01");
check("sin nada → free", resolvePlan(null, [], now).plan === "free");
check("pausa suave → sellOnly", resolvePlan({ plan: "pro", status: "pausa_suave", currentPeriodEnd: past }, [], now).sellOnly);
check("grant vencido → free", resolvePlan(null, [{ plan: "pro", vence: past, revoked: false }], now).plan === "free");
check("grant levanta pausa", !resolvePlan({ plan: "real", status: "pausa_suave", currentPeriodEnd: past }, [{ plan: "pro", vence: fut, revoked: false }], now).sellOnly);

// --- Cobranza ---
const d = (days: number) => new Date(now.getTime() - days * 8.64e7);
check("día 1 → pago_fallido", dunningStateFor(d(1), now) === "pago_fallido");
check("día 10 → pausa_suave", dunningStateFor(d(10), now) === "pausa_suave");
check("día 31 → cancelada", dunningStateFor(d(31), now) === "cancelada");

// --- Firma webhook MP ---
const ts = "1720000000";
const v1 = createHmac("sha256", "secreto-test").update(`id:12345;request-id:req;ts:${ts};`).digest("hex");
check("firma válida y fresca", verifyWebhookSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req", dataId: "12345", nowMs: Number(ts) * 1000 }));
check("firma inválida rechazada", !verifyWebhookSignature({ xSignature: `ts=${ts},v1=${"0".repeat(64)}`, xRequestId: "req", dataId: "12345", nowMs: Number(ts) * 1000 }));
check("replay viejo rechazado", !verifyWebhookSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req", dataId: "12345", nowMs: Number(ts) * 1000 + 20 * 60_000 }));

console.log(failed === 0 ? "\n✅ Todos los tests pasaron" : `\n❌ ${failed} test(s) fallaron`);
process.exit(failed === 0 ? 0 : 1);
