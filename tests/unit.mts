// Suite de tests de lógica pura (sin red) — corre en CI con `pnpm test:ci`.
// Cubre lo crítico: cifrado, indicadores, backtest+overlay de riesgo,
// comisiones, límite de ritmo, resolución de plan, cobranza y firma MP.
process.env.ENCRYPTION_KEY = "a".repeat(64);
process.env.BINANCE_USE_TESTNET = "true";
process.env.MP_WEBHOOK_SECRET = "secreto-test";

import { createHmac } from "node:crypto";
import { encrypt, decrypt } from "@/lib/crypto";
import { sma, rsi, ema, atr, macd, roc, rollingStd, highestHigh } from "@/lib/strategies/indicators";
import { strategies, defaultParams, evalSignal, getStrategy, signalWindow } from "@/lib/strategies";
import { initialStop, trailedStop } from "@/lib/risk";
import { clampDcaChunk, dcaChunk, dcaDue, investedAfterSell } from "@/lib/bot/decisions";
import { runBacktest } from "@/lib/backtest";
import { commissionIn, getKlinesPaged } from "@/lib/binance/client";
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

// --- Indicadores contra valores calculados a mano (un off-by-one en el
// suavizado pasaría los checks cualitativos y correría TODAS las señales) ---
const ema3 = ema([1, 2, 3, 4, 5], 3);
check("EMA(3) a mano", ema3[0] === null && ema3[1] === null && ema3[2] === 2 && ema3[3] === 3 && ema3[4] === 4);
const rsi2 = rsi([10, 11, 10, 11], 2);
check("RSI(2) a mano", rsi2[2] === 50 && rsi2[3] === 75);
const atrHand = atr([
  { high: 12, low: 10, close: 11 },
  { high: 13, low: 11, close: 12 },
  { high: 15, low: 12, close: 14 },
], 2);
check("ATR(2) a mano (semilla + Wilder)", atrHand[1] === 2 && atrHand[2] === 2.5);
check("ATR con exactamente `period` velas computa", atr([{ high: 12, low: 10, close: 11 }, { high: 13, low: 11, close: 12 }], 2)[1] === 2);
const macdHand = macd([1, 2, 3, 4, 5], 2, 3, 2);
check("MACD(2,3,2) a mano", Math.abs((macdHand.line[4] as number) - 0.5) < 1e-9 && Math.abs((macdHand.signal[4] as number) - 0.5) < 1e-9);

// --- Overlay de riesgo compartido (src/lib/risk.ts) ---
check("stop inicial por ATR", initialStop(100, 2, 2.5) === 95);
check("stop clampeado al 20% máximo", initialStop(100, 20, 2.5) === 80);
check("stop clampeado al 3% mínimo", initialStop(100, 0.4, 2.5) === 97);
check("stop sin ATR → fallback 8%", initialStop(100, null, 2.5) === 92);
check("stop apagado → null", initialStop(100, 2, 0) === null);
check("trailing nunca baja", trailedStop(152, 160, 10, 2) === 152);
check("trailing sube con el máximo", trailedStop(null, 160, 4, 2) === 152);
check("trailing sin ATR conserva el stop", trailedStop(152, 160, null, 2) === 152);
check("trailing apagado conserva el stop", trailedStop(90, 160, 4, 0) === 90);

// --- Decisiones puras del ejecutor (src/lib/bot/decisions.ts) ---
const dia = 8.64e7;
const hoy = new Date("2026-07-10T12:00:00Z");
check("DCA due sin compra previa", dcaDue(null, hoy, dia, 7));
check("DCA no due a los 6 días", !dcaDue(new Date(hoy.getTime() - 6 * dia), hoy, dia, 7));
check("DCA due a los 7 días", dcaDue(new Date(hoy.getTime() - 7 * dia), hoy, dia, 7));
check("chunk default = presupuesto/10", dcaChunk(undefined, 1000, 0) === 100);
check("chunk default nunca menor al piso (11)", dcaChunk(undefined, 50, 0) === 11);
check("chunk acotado por lo que queda", dcaChunk(200, 1000, 950) === 50);
check(
  "clamp del chunk: mismo en lab y robot",
  clampDcaChunk(undefined, 1000) === 100 && clampDcaChunk(5, 1000) === 11 && clampDcaChunk(5000, 1000) === 1000
);
check(
  "las pérdidas achican el presupuesto; las ganancias no lo agrandan",
  investedAfterSell(500, 400) === 100 && investedAfterSell(500, 600) === 0
);
// Paridad de sizing tras una pérdida de 100: el backtest gasta min(cash,
// capital) = 400 y el ejecutor budget − investedAfterSell = 400.
check(
  "paridad de sizing tras pérdidas",
  500 - investedAfterSell(500, 400) === Math.min(500 - 100, 500)
);

// --- Comisiones ---
const fills = [{ commission: "0.001", commissionAsset: "BTC" }, { commission: "1.25", commissionAsset: "USDT" }];
check("comisión en BTC", Math.abs(commissionIn(fills, "BTC") - 0.001) < 1e-9);
check("comisión BNB no afecta otros", commissionIn(fills, "ETH") === 0);

// --- Backtest + overlay de riesgo (velas sintéticas) ---
const mkStrat = (signalAt: Strategy["signalAt"]): Strategy => ({
  id: "t", nombre: "t", resumen: "", comoFunciona: [], riesgo: "moderado", intervalo: "1d", modo: "allin",
  params: [{ key: "stopAtr", label: "", min: 0, max: 10, step: 0.5, default: 2.5 }, { key: "trailingAtr", label: "", min: 0, max: 10, step: 0.5, default: 0 }],
  warmup: () => 3, signalAt,
});
const buyAt5 = mkStrat((_c, i) => (i === 5 ? "buy" : "hold"));
const stopC: Candle[] = [];
for (let i = 0; i < 8; i++) stopC.push(cndl(i, 100, 102, 98, 100));
stopC.push(cndl(8, 100, 101, 80, 99));
for (let i = 9; i < 14; i++) stopC.push(cndl(i, 99, 101, 97, 99));
const stopR = runBacktest(stopC, buyAt5, { stopAtr: 2.5, trailingAtr: 0 }, { initialCapitalUsd: 1000, slippagePct: 0 });
const stopSell = stopR.trades.find((t) => t.side === "sell");
check("stop salta con el low intra-vela", stopSell !== undefined && stopSell.price > 80 && stopSell.price < 100);
check("comisión menor → menos costos", runBacktest(stopC, buyAt5, { stopAtr: 2.5, trailingAtr: 0 }, { initialCapitalUsd: 1000, feePct: 0.075 }).costsUsd < runBacktest(stopC, buyAt5, { stopAtr: 2.5, trailingAtr: 0 }, { initialCapitalUsd: 1000, feePct: 0.1 }).costsUsd);

// Gap de apertura por debajo del stop: el fill es la APERTURA real, nunca el
// precio del stop (que ya no existe) — la regla que evita inflar resultados
// en crashes nocturnos.
const gapC: Candle[] = [];
for (let i = 0; i < 8; i++) gapC.push(cndl(i, 100, 102, 98, 100));
gapC.push(cndl(8, 85, 86, 80, 85)); // abre en 85, bien abajo del stop (92)
for (let i = 9; i < 14; i++) gapC.push(cndl(i, 85, 87, 84, 86));
const gapSell = runBacktest(gapC, buyAt5, { stopAtr: 2.5, trailingAtr: 0 }, { initialCapitalUsd: 1000, slippagePct: 0 }).trades.find((t) => t.side === "sell");
check("gap bajo el stop → fill en la apertura", gapSell !== undefined && gapSell.price === 85 && gapSell.reason.includes("gap"));

// Trailing chandelier: sube con el precio, JAMÁS baja, y el stop que dispara
// en la vela t se calculó con datos hasta t−1 (el ATR del propio crash no
// puede alejar el stop). Serie diseñada con ATR exacto: valor esperado
// cerrado = 120 + 2·(13/14)^10.
const trailC: Candle[] = [];
for (let i = 0; i < 31; i++) trailC.push(cndl(i, 100, 102, 98, 100)); // ATR = 4 exacto
for (let i = 31; i <= 40; i++) {
  const c = 100 + 3 * (i - 30); // sube 103 → 130 (TR pasa a 5)
  trailC.push(cndl(i, c - 3, c + 2, c - 2, c));
}
trailC.push(cndl(41, 130, 131, 126, 127)); // recorte que NO toca el trail
trailC.push(cndl(42, 127, 128, 60, 65)); // crash: dispara el trailing
for (let i = 43; i < 46; i++) trailC.push(cndl(i, 65, 66, 64, 65));
const trailR = runBacktest(trailC, mkStrat((_c, i) => (i === 30 ? "buy" : "hold")), { stopAtr: 2.5, trailingAtr: 2 }, { initialCapitalUsd: 1000, slippagePct: 0 });
const trailSell = trailR.trades.find((t) => t.side === "sell");
const trailEsperado = 120 + 2 * Math.pow(13 / 14, 10);
check(
  "trailing monotónico con regla t−1",
  trailSell !== undefined && trailSell.reason === "Stop de protección" && Math.abs(trailSell.price - trailEsperado) < 1e-6,
  trailSell ? `fill ${trailSell.price.toFixed(4)} vs esperado ${trailEsperado.toFixed(4)}` : "sin venta"
);

// Conservación de valor: round trip sin costos deja el capital intacto; con
// fee se pierden exactamente las dos puntas (detecta doble cobro o faltante).
const rtStrat = mkStrat((_c, i) => (i === 3 ? "buy" : i === 6 ? "sell" : "hold"));
const flat12 = Array.from({ length: 12 }, (_, i) => cndl(i, 100, 100, 100, 100));
const rt0 = runBacktest(flat12, rtStrat, {}, { initialCapitalUsd: 1000, feePct: 0, slippagePct: 0 });
check("round trip sin costos conserva el capital", rt0.finalValueUsd === 1000 && rt0.costsUsd === 0);
const rt1 = runBacktest(flat12, rtStrat, {}, { initialCapitalUsd: 1000, feePct: 0.1, slippagePct: 0 });
check("con fee 0,1% se pierden exactamente dos puntas", Math.abs(rt1.finalValueUsd - 1000 * 0.999 * 0.999) < 1e-9);
check("costos = fee de compra + fee de venta", Math.abs(rt1.costsUsd - (1 + 0.999)) < 1e-9);

// No piramidar: con señal de compra permanente hay UNA sola compra.
const alwaysBuy = mkStrat(() => "buy");
const flat14 = Array.from({ length: 14 }, (_, i) => cndl(i, 100, 102, 98, 100));
check("no piramida con posición abierta", runBacktest(flat14, alwaysBuy, {}, { initialCapitalUsd: 1000, slippagePct: 0 }).trades.length === 1);

// Cooldown: la vela del stop-out no recompra; la siguiente sí.
const cdR = runBacktest(stopC, alwaysBuy, { stopAtr: 2.5, trailingAtr: 0 }, { initialCapitalUsd: 1000, slippagePct: 0 });
check(
  "sin recompra en la vela del stop-out",
  cdR.trades.length === 3 && cdR.trades[1].side === "sell" && cdR.trades[2].side === "buy" && cdR.trades[2].time === stopC[9].closeTime
);

// DCA simula la política REAL del robot: chunk fijo (presupuesto/10 por
// defecto) cada N velas hasta agotar el presupuesto — no reparte el capital
// por todo el período mostrando compras que el ejecutor jamás haría.
const flat400 = Array.from({ length: 400 }, (_, i) => cndl(i, 100, 101, 99, 100));
const dcaR = runBacktest(flat400, getStrategy("dca")!, { cadaNVelas: 5 }, { initialCapitalUsd: 1000, feePct: 0, slippagePct: 0 });
check(
  "DCA: chunk del robot hasta agotar presupuesto",
  dcaR.trades.length === 10 && dcaR.trades.every((t) => t.side === "buy" && Math.abs(t.valueUsd - 100) < 1e-9)
);
check("DCA: respeta el calendario (cada 5 velas)", dcaR.trades[1].time - dcaR.trades[0].time === 5 * 8.64e7);
check("DCA: sin plata nueva tras agotar el presupuesto", dcaR.trades[9].time === flat400[46].closeTime);
const dcaCustom = runBacktest(flat400, getStrategy("dca")!, { cadaNVelas: 5, montoPorCompra: 250 }, { initialCapitalUsd: 1000, feePct: 0, slippagePct: 0 });
check("DCA: monto por compra personalizado", dcaCustom.trades.length === 4 && Math.abs(dcaCustom.trades[0].valueUsd - 250) < 1e-9);
let dcaEvalThrew = false;
try {
  evalSignal(getStrategy("dca")!, flat400, 300, defaultParams(getStrategy("dca")!));
} catch {
  dcaEvalThrew = true;
}
check("evalSignal rechaza DCA (cadencia de calendario, no señal)", dcaEvalThrew);

// --- Paginación de historia larga (getKlinesPaged con fetcher falso, sin
// red): lotes contiguos hacia atrás, sin huecos ni duplicados.
const pool = Array.from({ length: 2500 }, (_, i) => cndl(i, 100, 101, 99, 100));
const fakeFetch = async (_s: string, _i: string, limit: number, endTime?: number) => {
  const eligible = endTime === undefined ? pool : pool.filter((c) => c.openTime <= endTime);
  return eligible.slice(-Math.min(limit, 1000));
};
const paged = await getKlinesPaged("BTCUSDT", "1d", 2500, fakeFetch);
check("paginado junta el total pedido", paged.length === 2500);
check("paginado contiguo sin huecos ni duplicados", paged.every((c, i) => c.openTime === pool[i].openTime));
const pagedCorto = await getKlinesPaged("BTCUSDT", "1d", 300, fakeFetch);
check("pedido chico = una página con las velas más nuevas", pagedCorto.length === 300 && pagedCorto[0].openTime === pool[2200].openTime && pagedCorto[299].openTime === pool[2499].openTime);
check("historia agotada devuelve lo que hay", (await getKlinesPaged("BTCUSDT", "1d", 5000, fakeFetch)).length === 2500);

// Cada estrategia real corre sana sobre velas sintéticas (sin red)
const synth: Candle[] = Array.from({ length: 400 }, (_, i) => {
  const p = 100 + 30 * Math.sin(i / 20) + i * 0.1;
  return cndl(i, p - 1, p + 2, p - 2, p);
});
for (const s of strategies) {
  const ps = defaultParams(s);
  const r = runBacktest(synth, s, ps, { initialCapitalUsd: 500, slippagePct: 0.05 });
  check(`backtest sano: ${s.id}`, r.finalValueUsd > 0 && r.equityCurve.length === 400 && r.maxDrawdownPct >= 0 && r.maxDrawdownPct <= 100);

  // Anti look-ahead en varios puntos: mutar el futuro no cambia la señal en
  // i, y truncar la serie justo después de i tampoco.
  let lookAheadOk = true;
  for (const i of [250, 300, 350]) {
    const before = s.signalAt(synth, i, ps);
    const mut = synth.map((c, j) => (j > i ? { ...c, close: c.close * 3, high: c.high * 3, low: c.low * 3 } : c));
    if (before !== s.signalAt(mut, i, ps)) lookAheadOk = false;
    if (before !== s.signalAt(synth.slice(0, i + 1), i, ps)) lookAheadOk = false;
  }
  check(`sin look-ahead: ${s.id}`, lookAheadOk);

  // Paridad backtest↔ejecutor: la señal evaluada con TODA la historia
  // coincide con la evaluada sobre la ventana que descarga el robot en vivo.
  // Es el invariante del que depende el producto (AGENTS.md).
  if (s.modo !== "dca") {
    const w = signalWindow(s, ps);
    let parityOk = true;
    for (const i of [361, 380, 399]) {
      if (i + 1 - w < 0) continue;
      const win = synth.slice(i + 1 - w, i + 1);
      if (evalSignal(s, synth, i, ps) !== evalSignal(s, win, win.length - 1, ps)) parityOk = false;
    }
    check(`paridad de ventana: ${s.id}`, parityOk);
  }
}

// --- Señales de VENTA de cada estrategia (las salidas son donde se pierde
// plata y no estaban testeadas): montaña de 340 velas de suba +0,5% y 120 de
// caída −1,5% — cada estrategia tiene que gritar "sell" en algún momento.
const cima = 100 * Math.pow(1.005, 340);
const mountain: Candle[] = Array.from({ length: 460 }, (_, i) => {
  const p = i < 340 ? 100 * Math.pow(1.005, i) : cima * Math.pow(0.985, i - 340);
  return cndl(i, p * 0.999, p * 1.004, p * 0.996, p);
});
for (const s of strategies) {
  if (s.modo === "dca") continue; // el DCA no vende: es acumulación
  const ps = defaultParams(s);
  let vende = false;
  for (let i = s.warmup(ps) + 1; i < mountain.length && !vende; i++) {
    if (evalSignal(s, mountain, i, ps) === "sell") vende = true;
  }
  check(`emite señal de venta: ${s.id}`, vende);
}

// sma-cross vende por NIVEL: si el robot se pierde la vela exacta del cruce
// de muerte, la señal se repite en las velas siguientes (antes era solo la
// vela del cruce → posición sin salida hasta el próximo cruce).
{
  const s = getStrategy("sma-cross")!;
  const ps = defaultParams(s);
  let cruce = -1;
  for (let i = s.warmup(ps) + 1; i < mountain.length; i++) {
    if (evalSignal(s, mountain, i, ps) === "sell") { cruce = i; break; }
  }
  check(
    "sma-cross: la venta persiste después del cruce",
    cruce > 0 && evalSignal(s, mountain, cruce + 1, ps) === "sell" && evalSignal(s, mountain, cruce + 2, ps) === "sell"
  );
}

// --- Parámetros degenerados (post-clamp) no rompen ni operan de más ---
{
  const smaX = getStrategy("sma-cross")!;
  const invertidas = runBacktest(mountain, smaX, { ...defaultParams(smaX), corta: 50, larga: 20 }, { initialCapitalUsd: 1000, slippagePct: 0 });
  check("sma-cross con corta ≥ larga → nunca opera", invertidas.numTrades === 0);

  const don = getStrategy("donchian-techos")!;
  const donR = runBacktest(mountain, don, { ...defaultParams(don), ventanaEntrada: 10, ventanaSalida: 20 }, { initialCapitalUsd: 1000, slippagePct: 0 });
  check("donchian con salida > entrada se clampea y corre sano", donR.finalValueUsd > 0 && donR.maxDrawdownPct <= 100);

  const macdS = getStrategy("macd-ola")!;
  const psMacd = { ...defaultParams(macdS), filtroEma: 0 };
  let compra = false;
  for (let i = macdS.warmup(psMacd) + 1; i < synth.length && !compra; i++) {
    if (evalSignal(macdS, synth, i, psMacd) === "buy") compra = true;
  }
  check("macd-ola sin filtro de tendencia sigue operando", compra);

  const soloTrailing = runBacktest(synth, smaX, { ...defaultParams(smaX), stopAtr: 0, trailingAtr: 3 }, { initialCapitalUsd: 1000, slippagePct: 0 });
  check("stopAtr=0 + trailing>0 corre sano", soloTrailing.finalValueUsd > 0 && soloTrailing.maxDrawdownPct <= 100);
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
