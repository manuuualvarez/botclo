import { asc, eq, sql as query } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { botConfigs, botOrderFills, botOrderIntents, botTrades } from "../../db/schema";
import type { TradingIntentAction, TradingIntentMetadata, TradingIntentState } from "../../db/schema";
import type { ExchangeFill, ExchangeOrder, NewExchangeOrder } from "../binance/orders";
import { add, compare, divide, multiply, normalize, subtract } from "../binance/decimal";

export type TradingIntent = typeof botOrderIntents.$inferSelect;
export type StoredFill = typeof botOrderFills.$inferSelect;
type Bot = typeof botConfigs.$inferSelect;
export type CreateTradingIntent = {
  id: string;
  botId: number;
  userId: string;
  environment: "testnet" | "mainnet";
  accountId: string;
  symbol: string;
  action: TradingIntentAction;
  clientOrderId: string;
  request: NewExchangeOrder;
  metadata?: TradingIntentMetadata;
  replacesIntentId?: string | null;
};
export type IntentPatch = Partial<Pick<TradingIntent, "state" | "exchangeOrderId" | "stopPrice" | "metadata">>;

function assertBotIdentity(bot: Bot | undefined, intent: Pick<TradingIntent, "botId" | "userId" | "accountId" | "environment" | "symbol">) {
  if (!bot || bot.id !== intent.botId || bot.userId !== intent.userId || bot.symbol !== intent.symbol ||
      bot.exchangeAccountId !== intent.accountId || bot.tradingEnvironment !== intent.environment || bot.recoveryState === "legacy") {
    throw new Error("La identidad de cuenta/entorno del robot no coincide con la intención.");
  }
}

function nonnegative(value: string, field: string) {
  const decimal = normalize(value);
  if (compare(decimal, "0") < 0) throw new Error(`${field} no puede ser negativo.`);
  return decimal;
}

function stateFor(status: string): TradingIntentState {
  switch (status) {
    case "NEW": case "PARTIALLY_FILLED": return "open";
    case "PENDING_NEW": case "PENDING_CANCEL": return "unknown";
    case "FILLED": return "filled";
    case "CANCELED": case "EXPIRED": case "EXPIRED_IN_MATCH": return "canceled";
    case "REJECTED": return "rejected";
    default: throw new Error(`Estado de orden desconocido: ${status}`);
  }
}

function assertOrderIdentity(intent: TradingIntent, order: ExchangeOrder) {
  // cancelReplace puede asignar otro clientOrderId a la orden cancelada.
  // Una vez vinculado, el orderId remoto es la identidad estable; antes de
  // ese vínculo sigue siendo obligatorio el client ID creado localmente.
  const identityMatches = intent.exchangeOrderId === null
    ? order.clientOrderId === intent.clientOrderId
    : order.orderId === intent.exchangeOrderId;
  if (!identityMatches || order.symbol !== intent.symbol || order.side !== intent.request.side || order.type !== intent.request.type) {
    throw new Error("La identidad del snapshot no coincide con la orden persistida.");
  }
  if (!/^\d+$/.test(order.orderId)) throw new Error("orderId inválido.");
}

function normalizeFill(intent: TradingIntent, order: ExchangeOrder, fill: ExchangeFill): StoredFill {
  if (fill.orderId !== order.orderId || fill.symbol !== intent.symbol || !fill.id || !fill.commissionAsset ||
      !Number.isSafeInteger(fill.time) || fill.time <= 0) throw new Error("Identidad o fecha de fill inválida.");
  const qty = nonnegative(fill.qty, "qty");
  const price = nonnegative(fill.price, "price");
  if (compare(qty, "0") === 0 || compare(price, "0") === 0) throw new Error("Fill sin cantidad o precio.");
  return { intentId: intent.id, environment: intent.environment, accountId: intent.accountId, symbol: intent.symbol,
    tradeId: fill.id, orderId: fill.orderId, qty, price, quoteQty: nonnegative(fill.quoteQty, "quoteQty"),
    commission: nonnegative(fill.commission, "commission"), commissionAsset: fill.commissionAsset, time: fill.time };
}

function sameFill(left: StoredFill, right: StoredFill) {
  return left.intentId === right.intentId && left.orderId === right.orderId && left.symbol === right.symbol &&
    compare(left.qty, right.qty) === 0 && compare(left.quoteQty, right.quoteQty) === 0 && compare(left.price, right.price) === 0 &&
    compare(left.commission, right.commission) === 0 && left.commissionAsset === right.commissionAsset && left.time === right.time;
}

function projectFills(bot: Bot, intent: TradingIntent, fills: StoredFill[]) {
  if (!intent.symbol.endsWith("USDT")) throw new Error("El journal solo admite pares cotizados en USDT.");
  const baseAsset = intent.symbol.slice(0, -4);
  let qty = nonnegative(bot.positionQtyExact, "posición");
  let cost = nonnegative(bot.positionCostExact, "costo");
  let invested = nonnegative(bot.investedUsdtExact, "presupuesto consumido");
  let lastFillTime = 0;
  for (const fill of fills) {
    const baseFee = fill.commissionAsset === baseAsset ? fill.commission : "0";
    const quoteFee = fill.commissionAsset === "USDT" ? fill.commission : "0";
    if (intent.request.side === "BUY") {
      const netQty = subtract(fill.qty, baseFee);
      if (compare(netQty, "0") <= 0) throw new Error("Comisión base incompatible con la compra.");
      const fillCost = add(fill.quoteQty, quoteFee);
      qty = add(qty, netQty); cost = add(cost, fillCost); invested = add(invested, fillCost);
    } else {
      const consumed = add(fill.qty, baseFee);
      if (compare(consumed, qty) > 0) throw new Error("La venta excede la posición atribuida al robot.");
      const remainder = subtract(qty, consumed);
      cost = compare(remainder, "0") === 0 ? "0" : divide(multiply(cost, remainder), qty);
      qty = remainder;
      const proceeds = subtract(fill.quoteQty, quoteFee);
      if (compare(proceeds, "0") < 0) throw new Error("Comisión quote incompatible con la venta.");
      // Equivalente decimal de investedAfterSell: las pérdidas reducen el
      // presupuesto siguiente y las ganancias nunca lo amplían.
      invested = compare(invested, proceeds) > 0 ? subtract(invested, proceeds) : "0";
    }
    lastFillTime = Math.max(lastFillTime, fill.time);
  }
  const closed = compare(qty, "0") === 0;
  return {
    positionQtyExact: qty, positionCostExact: cost, investedUsdtExact: invested,
    positionQty: Number(qty), positionAvgPrice: closed ? 0 : Number(divide(cost, qty)), investedUsdt: Number(invested),
    ...(intent.request.side === "BUY" ? { lastBuyAt: new Date(lastFillTime) } : {}),
  };
}

/** Journal transaccional: la red ocurre fuera de este módulo y de sus locks. */
export function createTradingStore(connection: postgres.Sql) {
  const db = drizzle(connection);
  return {
    async listIntents(botId: number): Promise<TradingIntent[]> {
      return db.select().from(botOrderIntents).where(eq(botOrderIntents.botId, botId)).orderBy(asc(botOrderIntents.createdAt), asc(botOrderIntents.id));
    },
    async createIntent(input: CreateTradingIntent): Promise<TradingIntent> {
      return db.transaction(async (tx) => {
        const [bot] = await tx.select().from(botConfigs).where(eq(botConfigs.id, input.botId)).for("update");
        assertBotIdentity(bot, input);
        if (input.request.symbol !== input.symbol || input.request.clientOrderId !== input.clientOrderId ||
            (input.action === "buy") !== (input.request.side === "BUY") ||
            (["protect", "replace"].includes(input.action) !== (input.request.type === "STOP_LOSS"))) {
          throw new Error("La identidad/acción del request no coincide con la intención.");
        }
        const [intent] = await tx.insert(botOrderIntents).values({
          id: input.id, botId: input.botId, userId: input.userId, environment: input.environment, accountId: input.accountId,
          symbol: input.symbol, action: input.action, clientOrderId: input.clientOrderId, request: input.request,
          metadata: input.metadata ?? {}, replacesIntentId: input.replacesIntentId ?? null,
        }).returning();
        return intent;
      });
    },
    async updateIntent(id: string, patch: IntentPatch): Promise<TradingIntent> {
      const [intent] = await db.update(botOrderIntents).set({ ...patch, updatedAt: new Date() }).where(eq(botOrderIntents.id, id)).returning();
      if (!intent) throw new Error("Intención inexistente.");
      return intent;
    },
    async listFills(intentId: string): Promise<StoredFill[]> {
      return db.select().from(botOrderFills).where(eq(botOrderFills.intentId, intentId)).orderBy(asc(botOrderFills.time), asc(botOrderFills.tradeId));
    },
    async applyOrderSnapshot(intentId: string, order: ExchangeOrder, fills: ExchangeFill[], context: { intervalMs: number; reason: string }): Promise<{ intent: TradingIntent; newFillCount: number }> {
      if (!Number.isSafeInteger(context.intervalMs) || context.intervalMs <= 0) throw new Error("Intervalo inválido.");
      return db.transaction(async (tx) => {
        const [intent] = await tx.select().from(botOrderIntents).where(eq(botOrderIntents.id, intentId)).for("update");
        if (!intent) throw new Error("Intención inexistente.");
        const [bot] = await tx.select().from(botConfigs).where(eq(botConfigs.id, intent.botId)).for("update");
        assertBotIdentity(bot, intent);
        assertOrderIdentity(intent, order);
        const executedQty = nonnegative(order.executedQty, "executedQty");
        const quoteQty = nonnegative(order.cummulativeQuoteQty, "cummulativeQuoteQty");
        const state = stateFor(order.status);
        const known = await tx.select().from(botOrderFills).where(eq(botOrderFills.intentId, intent.id));
        const byId = new Map(known.map((fill) => [fill.tradeId, fill]));
        const fresh: StoredFill[] = [];
        for (const raw of fills) {
          const fill = normalizeFill(intent, order, raw);
          const previous = byId.get(fill.tradeId);
          if (previous && !sameFill(previous, fill)) throw new Error("Un fill conocido tiene contenido distinto.");
          if (!previous) { fresh.push(fill); byId.set(fill.tradeId, fill); }
        }
        // Un snapshot atrasado no hace retroceder contabilidad ni estados.
        if (compare(executedQty, intent.executedQty) < 0) {
          if (fresh.length) throw new Error("Snapshot atrasado contiene fills desconocidos.");
          return { intent, newFillCount: 0 };
        }
        const all = [...byId.values()];
        const totalQty = all.reduce((sum, fill) => add(sum, fill.qty), "0");
        const totalQuote = all.reduce((sum, fill) => add(sum, fill.quoteQty), "0");
        if (compare(totalQty, executedQty) !== 0 || compare(totalQuote, quoteQty) !== 0) {
          throw new Error("Los fills no cubren la cantidad/quote completa del snapshot.");
        }
        const terminal = ["filled", "canceled", "rejected"].includes(intent.state);
        const nextState = terminal && state === "open" && compare(executedQty, intent.executedQty) === 0 ? intent.state : state;
        const orderedFresh = fresh.sort((a, b) => a.time - b.time || a.tradeId.localeCompare(b.tradeId));
        if (orderedFresh.length) {
          const position = projectFills(bot, intent, orderedFresh);
          await tx.insert(botOrderFills).values(orderedFresh);
          await tx.update(botConfigs).set({ ...position, updatedAt: new Date() }).where(eq(botConfigs.id, bot.id));
          await tx.insert(botTrades).values(orderedFresh.map((fill) => ({
            botId: bot.id, userId: bot.userId, strategyId: bot.strategyId, symbol: bot.symbol, side: intent.request.side,
            qty: Number(intent.request.side === "BUY" && fill.commissionAsset === bot.symbol.slice(0, -4) ? subtract(fill.qty, fill.commission) : fill.qty),
            price: Number(fill.price), quoteQty: Number(intent.request.side === "SELL" && fill.commissionAsset === "USDT" ? subtract(fill.quoteQty, fill.commission) : fill.quoteQty),
            binanceOrderId: query`${order.orderId}::bigint`, reason: context.reason,
            isTestnet: intent.environment === "testnet", executedAt: new Date(fill.time),
          })));
        }
        // FILLED termina la salida solicitada aunque floorToStep haya dejado
        // dust. Conservamos ese remanente y su costo; no es una posición que
        // deba reabrir el stop anterior. Replays no borran un ciclo posterior.
        if (intent.request.side === "SELL" && nextState === "filled" && compare(executedQty, "0") > 0 &&
            (intent.state !== "filled" || fresh.length > 0)) {
          const lastFillTime = all.reduce((latest, fill) => Math.max(latest, fill.time), 0);
          const isStop = intent.request.type === "STOP_LOSS" || intent.metadata.exitReason === "stop";
          await tx.update(botConfigs).set({ stopPrice: null, highestClose: null,
            cooldownUntil: isStop ? new Date(lastFillTime + context.intervalMs) : null,
            updatedAt: new Date() }).where(eq(botConfigs.id, bot.id));
        }
        const stopPrice = order.stopPrice === undefined ? intent.stopPrice : nonnegative(order.stopPrice, "stopPrice");
        const [updated] = await tx.update(botOrderIntents).set({ state: nextState, exchangeOrderId: order.orderId,
          executedQty, quoteQty, stopPrice, updatedAt: new Date() }).where(eq(botOrderIntents.id, intent.id)).returning();
        if (intent.request.type === "STOP_LOSS") {
          if (nextState === "open" && stopPrice !== null) {
            await tx.update(botConfigs).set({ protectionIntentId: intent.id, confirmedStopPrice: stopPrice }).where(eq(botConfigs.id, bot.id));
          } else if (bot.protectionIntentId === intent.id) {
            await tx.update(botConfigs).set({ protectionIntentId: null, confirmedStopPrice: null }).where(eq(botConfigs.id, bot.id));
          }
        }
        return { intent: updated, newFillCount: fresh.length };
      });
    },
  };
}
