import { randomBytes, randomUUID } from "node:crypto";
import type { botConfigs, TradingIntentMetadata } from "../../db/schema";
import { add, compare, divide, floorToStep, multiply, subtract } from "../binance/decimal";
import { BinanceOrderError, type BinanceOrderClient, type ExchangeOrder, type NewExchangeOrder } from "../binance/orders";
import { initialStop } from "../risk";
import type { createTradingStore, TradingIntent } from "./trading-store";

type Bot = Pick<typeof botConfigs.$inferSelect, "id" | "userId" | "tradingId" | "symbol" | "status" |
  "tradingEnvironment" | "exchangeAccountId" | "recoveryState" | "recoveryReason" | "positionQtyExact" |
  "positionCostExact" | "investedUsdtExact" | "stopPrice" | "confirmedStopPrice" | "protectionIntentId" | "lastReconciledAt" | "createdAt">;
type Patch = Partial<typeof botConfigs.$inferInsert>;
type Store = Pick<ReturnType<typeof createTradingStore>, "listIntents" | "createIntent" | "updateIntent" | "applyOrderSnapshot">;
type Exchange = Pick<BinanceOrderClient, "getAccount" | "getRules" | "getLastPrice" | "getOrder" | "listOrders" | "listTrades" | "placeOrder" | "cancelReplace">;
const unresolved = new Set(["submitting", "unknown", "review"]);

export function clientOrderPrefix(tradingId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradingId)) throw new Error("Identidad del robot inválida.");
  return `bc_${Buffer.from(tradingId.replaceAll("-", ""), "hex").toString("base64url")}_`;
}

// Debe ejecutarse bajo el lock compartido del scheduler/acciones. No mantiene
// transacciones DB durante HTTP. Una excepción deja el journal recuperable.
export function createTradingEngine(deps: {
  exchange: Exchange; store: Store; loadBot: () => Promise<Bot>;
  saveBot: (patch: Patch) => Promise<void>; now?: () => Date; intervalMs?: number;
  knownBotPrefixes?: () => Promise<string[]>;
}) {
  const { exchange, store, loadBot, saveBot } = deps;
  const now = deps.now ?? (() => new Date());
  async function block(message: string, manual = false): Promise<never> {
    await saveBot({ recoveryState: "review", recoveryReason: `${manual ? "MANUAL: " : ""}${message}`, lastError: message });
    throw new Error(message);
  }
  async function identity() {
    const bot = await loadBot();
    if (!bot.exchangeAccountId || !bot.tradingEnvironment || bot.recoveryState === "legacy") {
      return block("Este robot todavía requiere adopción y conciliación.", true);
    }
    const account = await exchange.getAccount();
    if (account.uid !== bot.exchangeAccountId) return block("La cuenta Binance no coincide con la cuenta del robot.", true);
    if (account.canTrade === false) return block("La cuenta Binance no tiene trading habilitado.");
    return { bot, account };
  }
  async function apply(intent: TradingIntent, order: ExchangeOrder) {
    const fills = compare(order.executedQty, "0") > 0 ? await exchange.listTrades(intent.symbol, order.orderId) : [];
    const result = await store.applyOrderSnapshot(intent.id, order, fills, {
      intervalMs: intent.metadata.intervalMs ?? deps.intervalMs ?? 60_000,
      reason: intent.metadata.reason ?? "Orden recuperada desde Binance",
    });
    // La política se guardó ANTES de enviar BUY. También se recupera si el
    // proceso murió entre contabilizar los fills y calcular el primer stop.
    const bot = await loadBot();
    if (intent.action === "buy" && bot.stopPrice === null && compare(bot.positionQtyExact, "0") > 0 &&
        compare(order.executedQty, "0") > 0 && intent.metadata.protection) {
      const avg = Number(divide(order.cummulativeQuoteQty, order.executedQty));
      await saveBot({ stopPrice: initialStop(avg, intent.metadata.protection.atr, intent.metadata.protection.stopMultiple), highestClose: avg });
    }
    return result.intent;
  }
  async function reconcile() {
    const { bot } = await identity();
    const intents = await store.listIntents(bot.id);
    const from = Math.max(bot.createdAt.getTime(), (bot.lastReconciledAt?.getTime() ?? bot.createdAt.getTime()) - 60_000);
    const orders = await exchange.listOrders(bot.symbol, from, now().getTime());
    const prefix = clientOrderPrefix(bot.tradingId);
    const prefixes = await deps.knownBotPrefixes?.() ?? [prefix];
    if (orders.some(o => o.clientOrderId.startsWith("bc_") && !prefixes.some(p => o.clientOrderId.startsWith(p)))) {
      return block("Hay actividad Botclo de una identidad ausente del backup. Revisá el manifiesto externo antes de operar.", true);
    }
    const known = new Set(intents.map(i => i.clientOrderId));
    if (orders.some(o => o.clientOrderId.startsWith(prefix) && !known.has(o.clientOrderId))) {
      return block("Hay una orden Binance de este robot ausente del backup. Requiere recuperar el journal antes de operar.", true);
    }
    for (const intent of intents) {
      // Un backup puede tener planned aunque el proceso original después
      // haya enviado la orden. Siempre consultar; ausencia no autoriza resend.
      if (intent.state === "rejected") continue;
      // Consultar órdenes abiertas y desconocidas. Los fills terminales ya
      // fueron aplicados en la misma transacción que su estado terminal.
      if (["filled", "canceled"].includes(intent.state)) continue;
      // Binance puede renombrar clientOrderId al cancelar. El orderId ya
      // vinculado es la identidad estable incluso tras cancelReplace.
      const order = await exchange.getOrder(intent.symbol, intent.exchangeOrderId
        ? { orderId: intent.exchangeOrderId } : { clientOrderId: intent.clientOrderId });
      if (!order) return block("Binance todavía no confirma una orden pendiente. No se envían órdenes nuevas.");
      await apply(intent, order);
    }
    const current = await loadBot();
    // Recuperar el stop tras crash posterior a la transacción de BUY.
    if (current.stopPrice === null && compare(current.positionQtyExact, "0") > 0) {
      const lastBuy = (await store.listIntents(bot.id)).filter(i => compare(i.executedQty, "0") > 0).at(-1);
      if (lastBuy?.action === "buy" && lastBuy.metadata.protection) {
        const avg = Number(divide(lastBuy.quoteQty, lastBuy.executedQty));
        await saveBot({ stopPrice: initialStop(avg, lastBuy.metadata.protection.atr, lastBuy.metadata.protection.stopMultiple), highestClose: avg });
      }
    }
    const rules = await exchange.getRules(bot.symbol);
    const account = await exchange.getAccount();
    if (account.uid !== bot.exchangeAccountId) return block("La cuenta Binance cambió durante la conciliación.", true);
    const balance = account.balances.find(b => b.asset === rules.baseAsset);
    // El saldo solo sirve como límite; jamás se lo adjudicamos al robot.
    if (compare(add(balance?.free ?? "0", balance?.locked ?? "0"), current.positionQtyExact) < 0) {
      return block("El saldo en Binance es menor que la posición registrada. Revisá ventas o transferencias externas.", true);
    }
    if (current.recoveryReason?.startsWith("MANUAL:")) throw new Error(current.recoveryReason);
    await saveBot({ recoveryState: "ready", recoveryReason: null, lastReconciledAt: now(), lastError: null });
  }
  async function ready(allowPaused: boolean, protecting = false) {
    const { bot } = await identity();
    if (bot.recoveryState !== "ready") throw new Error(bot.recoveryReason ?? "El robot requiere conciliación.");
    if (!allowPaused && bot.status !== "active") throw new Error("El robot está pausado.");
    const intents = await store.listIntents(bot.id);
    if (intents.some(i => unresolved.has(i.state) || i.state === "planned" ||
        (i.state === "open" && i.request.type === "MARKET" && (!protecting || i.request.side === "SELL")))) {
      return block("Hay una orden sin resolver. Conciliá antes de operar.");
    }
    return { bot, intents };
  }
  async function submit(bot: Bot, request: Omit<NewExchangeOrder, "clientOrderId" | "symbol">,
    metadata: TradingIntentMetadata, replaces?: TradingIntent) {
    const clientOrderId = clientOrderPrefix(bot.tradingId) + randomBytes(7).toString("base64url");
    const input: NewExchangeOrder = { ...request, symbol: bot.symbol, clientOrderId };
    const intent = await store.createIntent({ id: randomUUID(), botId: bot.id, userId: bot.userId,
      environment: bot.tradingEnvironment!, accountId: bot.exchangeAccountId!, symbol: bot.symbol,
      action: request.side === "BUY" ? "buy" : request.type === "MARKET" ? "sell" : replaces ? "replace" : "protect",
      clientOrderId, request: input, metadata, replacesIntentId: replaces?.id });
    await store.updateIntent(intent.id, { state: "submitting" });
    let exchangeResponded = false;
    try {
      if (!replaces) {
        const order = await exchange.placeOrder(input);
        exchangeResponded = true;
        return await apply(intent, order);
      }
      if (!replaces.exchangeOrderId) throw new Error("La protección anterior no tiene ID confirmado.");
      const result = await exchange.cancelReplace({ symbol: bot.symbol, orderId: replaces.exchangeOrderId, newOrder: input });
      exchangeResponded = true;
      if (result.canceledOrder) await apply(replaces, result.canceledOrder);
      if (result.newOrder) return await apply(intent, result.newOrder);
      // FAILURE no prueba que la orden anterior siga abierta: pudo ejecutarse.
      const old = await exchange.getOrder(bot.symbol, { orderId: replaces.exchangeOrderId });
      if (old) await apply(replaces, old);
      await store.updateIntent(intent.id, { state: "rejected" });
      return block(result.cancelResult === "SUCCESS"
        ? "La orden anterior fue cancelada y Binance rechazó la nueva. La posición requiere protección."
        : "Binance no pudo reemplazar la orden. Se conciliará antes de reintentar.");
    } catch (error) {
      const stored = (await store.listIntents(bot.id)).find(i => i.id === intent.id)!;
      if (stored.state === "submitting") {
        await store.updateIntent(intent.id, { state: !exchangeResponded && error instanceof BinanceOrderError ? "rejected" : "unknown" });
      }
      await saveBot({ recoveryState: "review", recoveryReason: "La orden requiere conciliación antes de continuar.", lastError: error instanceof Error ? error.message : "No se confirmó la orden." });
      throw error;
    }
  }
  async function protectionRequest(bot: Bot) {
    const rules = await exchange.getRules(bot.symbol);
    if (rules.status !== "TRADING" || !rules.orderTypes.includes("STOP_LOSS")) return block("El par no admite STOP_LOSS de mercado.", true);
    const quantity = floorToStep(bot.positionQtyExact, rules.stepSize);
    const stopPrice = floorToStep(String(bot.stopPrice), rules.tickSize);
    if (compare(quantity, rules.minQty) < 0 || compare(multiply(quantity, stopPrice), rules.minNotional) < 0) {
      return block("La posición está por debajo del mínimo para protegerla en Binance. No se borró del registro.", true);
    }
    return { quantity, stopPrice, rules };
  }
  async function protect() {
    const { bot, intents } = await ready(true, true);
    if (bot.stopPrice === null || compare(bot.positionQtyExact, "0") === 0) return;
    const { quantity, stopPrice, rules } = await protectionRequest(bot);
    const open = intents.filter(i => i.state === "open" && i.request.type === "STOP_LOSS");
    if (open.length > 1) return block("Hay más de una protección abierta para el robot.", true);
    const prior = open[0];
    const currentPrice = await exchange.getLastPrice(bot.symbol);
    const intervalMs = prior?.metadata.intervalMs ?? intents.filter(i => i.action === "buy").at(-1)?.metadata.intervalMs ?? deps.intervalMs;
    // Si la orden residente ya cruzó su disparador, Binance administra su
    // ejecución. No emitir una segunda venta para la misma posición.
    if (prior && compare(currentPrice, prior.request.stopPrice!) <= 0) return;
    if (compare(currentPrice, stopPrice) <= 0) {
      if (prior && compare(prior.executedQty, "0") > 0) return block("La protección se está ejecutando parcialmente.");
      if (prior && !rules.cancelReplaceAllowed) return block("No se puede coordinar la salida con el stop existente.", true);
      // Equivale al stop local ya cruzado. Intentar registrar un STOP_LOSS
      // aquí sería rechazado por activación inmediata, dejando un loop.
      await submit(bot, { side: "SELL", type: "MARKET", quantity },
        { reason: "Stop de protección: el precio ya cruzó el límite", exitReason: "stop", intervalMs }, prior);
      return;
    }
    if (prior && compare(subtract(prior.request.quantity!, prior.executedQty), quantity) === 0 &&
        compare(prior.request.stopPrice!, stopPrice) === 0) return;
    if (prior && compare(prior.executedQty, "0") > 0) return block("La protección se está ejecutando parcialmente. Se espera su resultado antes de reemplazarla.");
    if (prior && !rules.cancelReplaceAllowed) return block("El par no admite reemplazar la protección.", true);
    await submit(bot, { side: "SELL", type: "STOP_LOSS", quantity, stopPrice },
      { reason: "Stop de protección residente en Binance", intervalMs }, prior);
  }
  async function buy(quoteOrderQty: string, metadata: TradingIntentMetadata) {
    const { bot, intents } = await ready(false);
    if (intents.some(i => i.state === "open" && i.request.type === "STOP_LOSS")) throw new Error("La posición existente ya tiene una protección abierta.");
    // Validar soporte antes de abrir una posición que exige stop.
    if ((metadata.protection?.stopMultiple ?? 0) > 0) {
      const rules = await exchange.getRules(bot.symbol);
      if (!rules.orderTypes.includes("STOP_LOSS")) return block("El par no admite el stop requerido.", true);
    }
    await submit(bot, { side: "BUY", type: "MARKET", quoteOrderQty }, metadata);
    await protect();
  }
  async function sell(metadata: TradingIntentMetadata) {
    const { bot, intents } = await ready(false);
    if (compare(bot.positionQtyExact, "0") <= 0) return;
    const rules = await exchange.getRules(bot.symbol);
    const lot = rules.marketLotSize && compare(rules.marketLotSize.stepSize, "0") > 0 ? rules.marketLotSize : rules;
    const quantity = floorToStep(bot.positionQtyExact, lot.stepSize);
    if (compare(quantity, lot.minQty) < 0 || compare(quantity, "0") === 0) return block("La posición es demasiado chica para venderla.", true);
    const open = intents.filter(i => i.state === "open" && i.request.type === "STOP_LOSS");
    if (open.length > 1) return block("Hay varias protecciones abiertas.", true);
    if (open[0] && compare(open[0].executedQty, "0") > 0) return block("La protección se está ejecutando parcialmente. Se espera su resultado antes de vender.");
    if (open.length && !rules.cancelReplaceAllowed) return block("El par no admite venta coordinada con su stop.", true);
    await submit(bot, { side: "SELL", type: "MARKET", quantity }, metadata, open[0]);
  }
  return { reconcile, protect, buy, sell };
}
