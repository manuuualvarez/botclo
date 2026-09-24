import { and, eq, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, pg } from "../../db";
import { botConfigs } from "../../db/schema";
import { getKlines, isTestnet } from "../binance/client";
import { readTradingAccount } from "./trading-access";
import { add, compare, divide, floorToStep } from "../binance/decimal";
import { BinanceOrderClient } from "../binance/orders";
import { INTERVAL_MS } from "../intervals";
import { getEntitlement, plansEnforced } from "../plan";
import { atrAt, ATR_WINDOW, trailedStop } from "../risk";
import { defaultParams, evalSignal, getStrategy, signalWindow } from "../strategies";
import { dcaChunk, dcaDue } from "./decisions";
import type { BotConfig, TickOutcome } from "./executor";
import { prepareLegacyAdoption } from "./trading-adoption";
import { clientOrderPrefix, createTradingEngine } from "./trading-engine";
import { createTradingStore } from "./trading-store";

export function nativeProtectionEnabled() { return process.env.BOT_NATIVE_PROTECTION_ENABLED === "true"; }

// Preserva Retry-After entre ticks del mismo proceso. La huella invalida el
// cliente al rotar claves sin guardar ni imprimir credenciales adicionales.
const clients = new Map<string, { fingerprint: string; client: BinanceOrderClient }>();

// Se invoca únicamente bajo withTradingLock. La adopción consulta los fills
// legados; no asigna al robot el saldo de la billetera ni inventa operaciones.
export async function nativeContext(initial: BotConfig) {
  const credentials = await readTradingAccount(initial.userId);
  if (!credentials) throw new Error("No hay una cuenta Binance conectada.");
  const environment = isTestnet() ? "testnet" : "mainnet";
  if (initial.tradingEnvironment && initial.tradingEnvironment !== environment) throw new Error("El robot pertenece a otro entorno Binance.");
  const cacheKey = `${initial.userId}:${environment}`;
  const fingerprint = createHash("sha256").update(credentials.apiKey).update("\0").update(credentials.apiSecret).digest("hex");
  const cached = clients.get(cacheKey);
  const exchange = cached?.fingerprint === fingerprint ? cached.client : new BinanceOrderClient({ ...credentials, environment });
  clients.set(cacheKey, { fingerprint, client: exchange });
  const loadBot = async () => {
    const row = await db.query.botConfigs.findFirst({ where: and(eq(botConfigs.id, initial.id), eq(botConfigs.userId, initial.userId)) });
    if (!row) throw new Error("El robot ya no existe.");
    return row;
  };
  const saveBot = async (patch: Partial<typeof botConfigs.$inferInsert>) => {
    await db.update(botConfigs).set({ ...patch, updatedAt: new Date() }).where(eq(botConfigs.id, initial.id));
  };
  const store = createTradingStore(pg);
  if (initial.recoveryState === "legacy" || (!initial.exchangeAccountId && !initial.tradingEnvironment)) {
    if (!nativeProtectionEnabled()) throw new Error("La adopción de protección Binance está deshabilitada.");
    if ((await store.listIntents(initial.id)).length) throw new Error("Existe un journal previo: no se puede volver al ejecutor legado.");
    const trades = await pg<{ binanceOrderId: string | null; side: "BUY" | "SELL"; symbol: string; isTestnet: boolean; qty: number; quoteQty: number }[]>`
      SELECT binance_order_id::text AS "binanceOrderId", side, symbol, is_testnet AS "isTestnet", qty, quote_qty AS "quoteQty"
      FROM bot_trades WHERE bot_id=${initial.id} ORDER BY executed_at, id
    `;
    try {
      const baseline = await prepareLegacyAdoption({ bot: initial, trades: [...trades], exchange, environment });
      await saveBot({ ...baseline,
        positionQty: Number(baseline.positionQtyExact),
        positionAvgPrice: compare(baseline.positionQtyExact, "0") === 0 ? 0 : Number(divide(baseline.positionCostExact, baseline.positionQtyExact)),
        investedUsdt: Number(baseline.investedUsdtExact),
        recoveryState: "ready", recoveryReason: null, lastReconciledAt: new Date() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "La adopción requiere revisión.";
      await saveBot({ recoveryState: "review", recoveryReason: `MANUAL: ${message}`, lastError: message });
      throw error;
    }
  }
  const strategy = getStrategy(initial.strategyId);
  const intervalMs = strategy ? INTERVAL_MS[strategy.intervalo] : 60_000;
  const account = await exchange.getAccount();
  const related = await db.select().from(botConfigs).where(or(eq(botConfigs.userId, initial.userId), eq(botConfigs.exchangeAccountId, account.uid)));
  const verifyAccountCoverage = async () => {
    // Consultar después de conciliar: un stop pudo vender durante la caída.
    const current = await db.select().from(botConfigs).where(or(eq(botConfigs.userId, initial.userId), eq(botConfigs.exchangeAccountId, account.uid)));
    const ownedTotal = current.filter(b => b.symbol === initial.symbol && (!b.tradingEnvironment || b.tradingEnvironment === environment))
      .reduce((sum, b) => add(sum, b.recoveryState === "legacy" ? String(b.positionQty) : b.positionQtyExact), "0");
    const remote = await exchange.getAccount();
    const balance = remote.balances.find(b => b.asset === initial.symbol.slice(0, -4));
    if (compare(add(balance?.free ?? "0", balance?.locked ?? "0"), ownedTotal) < 0) {
      // Otro robot del mismo par puede tener fills por importar en este
      // barrido. Volver a conciliar; no fijar un bloqueo manual irreversible.
      await saveBot({ recoveryState: "review", recoveryReason: "El saldo no cubre todas las posiciones atribuidas. Se requiere conciliación de la cuenta.", lastError: "El saldo Binance no cubre las posiciones registradas." });
      throw new Error("El saldo Binance no cubre las posiciones registradas.");
    }
  };
  const engine = createTradingEngine({ exchange, store, loadBot, saveBot, intervalMs,
    knownBotPrefixes: async () => related.map(b => clientOrderPrefix(b.tradingId)) });
  return { engine, loadBot, saveBot, exchange, store, intervalMs, verifyAccountCoverage };
}

export async function runNativeBotTick(initial: BotConfig): Promise<TickOutcome> {
  const outcome = (action: TickOutcome["action"], detail: string): TickOutcome => ({ botId: initial.id, userId: initial.userId, action, detail });
  const { engine, loadBot, saveBot, exchange, intervalMs, verifyAccountCoverage } = await nativeContext(initial);
  await engine.reconcile();
  await verifyAccountCoverage();
  await engine.protect();
  const bot = await loadBot();
  await saveBot({ lastRunAt: new Date() });
  if (bot.positionQty < initial.positionQty) {
    await saveBot({ lastSignal: "venta conciliada desde Binance" });
    return outcome("sell", `venta conciliada desde Binance; posición restante: ${bot.positionQtyExact} ${bot.symbol.slice(0, -4)}`);
  }
  if (bot.status !== "active") return outcome("hold", "robot pausado; conciliación y protección Binance vigentes");
  const strategy = getStrategy(bot.strategyId);
  if (!strategy) throw new Error("Estrategia desconocida.");
  const params = { ...defaultParams(strategy), ...(bot.params as Record<string, number>) };
  const now = new Date();
  let buysBlocked = false;
  if (plansEnforced()) {
    const entitlement = await getEntitlement(bot.userId);
    buysBlocked = !entitlement.limits.modoReal || entitlement.sellOnly;
  }
  const window = Math.max(signalWindow(strategy, params), ATR_WINDOW);
  const closed = (await getKlines(bot.symbol, strategy.intervalo, Math.min(1000, window + 1))).slice(0, -1);
  if (closed.length < strategy.warmup(params) + 1) return outcome("skip", "historia insuficiente");
  const i = closed.length - 1;
  const candle = closed[i];
  if (bot.lastCandleTime === candle.openTime) return outcome("hold", "sin vela nueva");
  // El lock serializa los ticks. La vela se marca después de decidir: un
  // crash antes de persistir la intención no puede consumir la señal.
  const finish = async (action: TickOutcome["action"], detail: string) => {
    await saveBot({ lastCandleTime: candle.openTime });
    return outcome(action, detail);
  };
  if (bot.positionQty > 0 && strategy.modo !== "dca" && (params.trailingAtr ?? 0) > 0) {
    const highestClose = Math.max(bot.highestClose ?? 0, candle.close);
    await saveBot({ highestClose, stopPrice: trailedStop(bot.stopPrice, highestClose, atrAt(closed, i), params.trailingAtr) });
    await engine.protect();
  }
  const rules = await exchange.getRules(bot.symbol);
  const metadata = { intervalMs, reason: `Señal de ${strategy.nombre}`,
    ...(strategy.modo === "dca" ? {} : { protection: { atr: atrAt(closed, i), stopMultiple: params.stopAtr ?? 0 } }) };
  const quote = (amount: number) => floorToStep(String(amount), `1e-${rules.quoteAssetPrecision}`);
  if (strategy.modo === "dca") {
    const chunk = dcaChunk(params.montoPorCompra, bot.budgetUsdt, bot.investedUsdt);
    if (!buysBlocked && chunk >= Math.max(10, Number(rules.minNotional)) && dcaDue(bot.lastBuyAt, now, intervalMs, params.cadaNVelas)) {
      await engine.buy(quote(chunk), { ...metadata, reason: `Compra periódica (${strategy.nombre})` });
      await saveBot({ lastSignal: "compró", lastError: null });
      return finish("buy", "compra conciliada con Binance");
    }
    await saveBot({ lastSignal: buysBlocked ? "compras pausadas por el plan" : "esperando la próxima compra" });
    return finish("hold", "esperando la próxima compra periódica");
  }
  const signal = evalSignal(strategy, closed, i, params);
  const hasPosition = bot.positionQty * candle.close >= 5;
  if (signal === "sell" && hasPosition) {
    await engine.sell(metadata);
    await saveBot({ lastSignal: "vendió", lastError: null });
    return finish("sell", "venta conciliada con Binance");
  }
  const cooldown = bot.cooldownUntil && bot.cooldownUntil.getTime() > now.getTime();
  if (signal === "buy" && !hasPosition && !cooldown && !buysBlocked) {
    const spend = bot.budgetUsdt - bot.investedUsdt;
    if (spend < Math.max(10, Number(rules.minNotional))) return finish("skip", "sin presupuesto");
    await engine.buy(quote(spend), metadata);
    await saveBot({ lastSignal: "compró", lastError: null });
    return finish("buy", "compra conciliada; protección registrada según la estrategia");
  }
  await saveBot({ lastSignal: signal === "hold" ? "sin señal, esperando" : `señal ${signal} (sin acción)`, lastError: null });
  return finish("hold", `señal: ${signal}`);
}
