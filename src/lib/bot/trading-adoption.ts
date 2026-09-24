import { add, compare, divide, multiply, normalize, subtract } from "../binance/decimal";
import type { BinanceEnvironment, BinanceOrderClient, ExchangeFill, ExchangeRules } from "../binance/orders";

export interface LegacyBot {
  symbol: string;
  positionQty: number;
  positionAvgPrice: number;
  investedUsdt: number;
}

// El caller lee binance_order_id::text: convertir el bigint SQL a Number
// antes de llegar acá puede perder la identidad de la orden irrevocablemente.
export interface LegacyTrade {
  binanceOrderId: string | null;
  symbol: string;
  side: string;
  isTestnet: boolean;
  qty: number;
  quoteQty: number;
}

export interface LegacyAdoptionPlan {
  exchangeAccountId: string;
  tradingEnvironment: BinanceEnvironment;
  positionQtyExact: string;
  positionCostExact: string;
  investedUsdtExact: string;
}

type Exchange = Pick<BinanceOrderClient, "environment" | "getAccount" | "getRules" | "getOrder" | "listTrades">;
interface VerifiedTrade { ledger: LegacyTrade; orderId: string; fills: ExchangeFill[]; time: number }
interface Position { qty: string; cost: string; invested: string }

function nonnegative(value: string, field: string): string {
  const result = normalize(value);
  if (compare(result, "0") < 0) throw new Error(`${field} no puede ser negativo.`);
  return result;
}

function legacyNumber(value: number, field: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} legacy inválido.`);
  return normalize(String(value));
}

function distance(left: string, right: string): string {
  return compare(left, right) >= 0 ? subtract(left, right) : subtract(right, left);
}

function assertLegacyNumber(actual: number, expected: string, field: string, dust = "0") {
  const value = legacyNumber(actual, field);
  const expectedNumber = Number(expected);
  if (!Number.isFinite(expectedNumber)) throw new Error(`${field} excede la precisión legacy.`);
  // Solo la frontera contra DOUBLE PRECISION usa Number; el baseline siempre
  // sale de los decimales remotos. El step nunca corrige discrepancias del ledger.
  const roundoff = String(Math.max(1, Math.abs(actual), Math.abs(expectedNumber)) * Number.EPSILON * 16);
  if (compare(distance(value, expected), add(roundoff, dust)) > 0) {
    throw new Error(`${field} legacy no coincide con el historial verificado; requiere revisión.`);
  }
}

function validateLedger(bot: LegacyBot, trades: readonly LegacyTrade[], environment: BinanceEnvironment) {
  legacyNumber(bot.positionQty, "Posición");
  legacyNumber(bot.positionAvgPrice, "Precio promedio");
  legacyNumber(bot.investedUsdt, "Inversión");
  const ids = new Set<string>();
  for (const trade of trades) {
    if (typeof trade.binanceOrderId !== "string" || !/^[1-9]\d*$/.test(trade.binanceOrderId)) {
      throw new Error("El historial contiene una orden sin ID exacto; requiere revisión.");
    }
    if (ids.has(trade.binanceOrderId)) throw new Error("El historial duplica una orden; requiere revisión.");
    ids.add(trade.binanceOrderId);
    if (trade.symbol !== bot.symbol || trade.isTestnet !== (environment === "testnet") ||
        (trade.side !== "BUY" && trade.side !== "SELL")) {
      throw new Error("La identidad/sentido/entorno del historial no corresponde al robot.");
    }
    legacyNumber(trade.qty, "Cantidad del historial");
    legacyNumber(trade.quoteQty, "Importe del historial");
  }
  if (trades.length === 0 && (bot.positionQty !== 0 || bot.positionAvgPrice !== 0 || bot.investedUsdt !== 0)) {
    throw new Error("No hay historial para demostrar la posición o inversión legacy.");
  }
}

function validateFill(fill: ExchangeFill, orderId: string, symbol: string, seen: Set<string>): ExchangeFill {
  if (fill.orderId !== orderId || fill.symbol !== symbol || !/^\d+$/.test(fill.id) || seen.has(fill.id) ||
      !fill.commissionAsset || !Number.isSafeInteger(fill.time) || fill.time <= 0) {
    throw new Error("Identidad, fecha o duplicado de fill inválido; requiere revisión.");
  }
  seen.add(fill.id);
  const normalized = { ...fill, qty: nonnegative(fill.qty, "Cantidad del fill"), price: nonnegative(fill.price, "Precio del fill"),
    quoteQty: nonnegative(fill.quoteQty, "Importe del fill"), commission: nonnegative(fill.commission, "Comisión del fill") };
  if (compare(normalized.qty, "0") <= 0 || compare(normalized.price, "0") <= 0 || compare(normalized.quoteQty, "0") <= 0) {
    throw new Error("Fill sin ejecución económica válida.");
  }
  return normalized;
}

function total(fills: readonly ExchangeFill[], field: "qty" | "quoteQty", feeAsset?: string): string {
  return fills.reduce((sum, fill) => add(sum, feeAsset === undefined ? fill[field] : fill.commissionAsset === feeAsset ? fill.commission : "0"), "0");
}

async function verifyTrade(ledger: LegacyTrade, exchange: Exchange, rules: ExchangeRules, seen: Set<string>): Promise<VerifiedTrade> {
  const orderId = ledger.binanceOrderId!;
  const order = await exchange.getOrder(ledger.symbol, { orderId });
  if (!order || order.orderId !== orderId || order.symbol !== ledger.symbol || order.side !== ledger.side ||
      order.type !== "MARKET" || order.status !== "FILLED") {
    throw new Error("La orden legacy no está confirmada/completa o su identidad no coincide; requiere revisión.");
  }
  const fills = (await exchange.listTrades(ledger.symbol, orderId))
    .map(fill => validateFill(fill, orderId, ledger.symbol, seen));
  const qty = total(fills, "qty"); const quote = total(fills, "quoteQty");
  if (fills.length === 0 || compare(qty, order.executedQty) !== 0 || compare(quote, order.cummulativeQuoteQty) !== 0) {
    throw new Error("Los fills no cubren la ejecución completa de la orden legacy.");
  }
  const legacyQty = ledger.side === "BUY" ? subtract(qty, total(fills, "qty", rules.baseAsset)) : qty;
  const legacyQuote = ledger.side === "SELL" ? subtract(quote, total(fills, "quoteQty", rules.quoteAsset)) : quote;
  assertLegacyNumber(ledger.qty, legacyQty, "Cantidad del historial");
  assertLegacyNumber(ledger.quoteQty, legacyQuote, "Importe del historial");
  return { ledger, orderId, fills, time: Math.min(...fills.map(fill => fill.time)) };
}

function projectFill(position: Position, side: string, fill: ExchangeFill, rules: ExchangeRules) {
  const baseFee = fill.commissionAsset === rules.baseAsset ? fill.commission : "0";
  const quoteFee = fill.commissionAsset === rules.quoteAsset ? fill.commission : "0";
  if (side === "BUY") {
    const netQty = subtract(fill.qty, baseFee);
    if (compare(netQty, "0") <= 0) throw new Error("Comisión base incompatible con la compra.");
    const cost = add(fill.quoteQty, quoteFee);
    position.qty = add(position.qty, netQty); position.cost = add(position.cost, cost);
    position.invested = add(position.invested, cost);
    return;
  }
  const consumed = add(fill.qty, baseFee);
  if (compare(consumed, position.qty) > 0) throw new Error("La venta excede la posición atribuida por el historial.");
  const remaining = subtract(position.qty, consumed);
  position.cost = compare(remaining, "0") === 0 ? "0" : divide(multiply(position.cost, remaining), position.qty);
  position.qty = remaining;
  const proceeds = subtract(fill.quoteQty, quoteFee);
  if (compare(proceeds, "0") < 0) throw new Error("Comisión quote incompatible con la venta.");
  position.invested = compare(position.invested, proceeds) > 0 ? subtract(position.invested, proceeds) : "0";
}

function projectLegacy(position: Position, trade: VerifiedTrade, rules: ExchangeRules) {
  // Reproduce la contabilidad anterior SOLO para contrastar la fila legacy.
  // Su SELL cerraba toda la posición local incluso cuando dejaba polvo.
  const quote = total(trade.fills, "quoteQty");
  if (trade.ledger.side === "BUY") {
    position.qty = add(position.qty, subtract(total(trade.fills, "qty"), total(trade.fills, "qty", rules.baseAsset)));
    position.cost = add(position.cost, quote); position.invested = add(position.invested, quote);
  } else {
    const proceeds = subtract(quote, total(trade.fills, "quoteQty", rules.quoteAsset));
    position.qty = "0"; position.cost = "0";
    position.invested = compare(position.invested, proceeds) > 0 ? subtract(position.invested, proceeds) : "0";
  }
}

/** Solo lectura: el caller mantiene el lock y persiste este plan atómicamente.
 * Nunca adopta el saldo entero ni envía órdenes. Sin prueba completa, falla. */
export async function prepareLegacyAdoption(input: {
  bot: LegacyBot; trades: readonly LegacyTrade[]; exchange: Exchange; environment: BinanceEnvironment;
}): Promise<LegacyAdoptionPlan> {
  const { bot, trades, exchange, environment } = input;
  if (exchange.environment !== environment) throw new Error("El cliente Binance usa otro entorno.");
  validateLedger(bot, trades, environment);
  const rules = await exchange.getRules(bot.symbol);
  if (rules.symbol !== bot.symbol || rules.quoteAsset !== "USDT" || !rules.baseAsset || compare(rules.stepSize, "0") <= 0) {
    throw new Error("Los filtros no corresponden al par USDT del robot.");
  }
  const account = await exchange.getAccount();
  if (!/^\d+$/.test(account.uid) || account.canTrade === false) throw new Error("La identidad/permisos de la cuenta Binance requiere revisión.");
  const verified: VerifiedTrade[] = [];
  const seen = new Set<string>();
  for (const trade of trades) verified.push(await verifyTrade(trade, exchange, rules, seen));
  verified.sort((a, b) => a.time - b.time || (BigInt(a.orderId) < BigInt(b.orderId) ? -1 : 1));
  const position: Position = { qty: "0", cost: "0", invested: "0" };
  const legacy: Position = { qty: "0", cost: "0", invested: "0" };
  const chronologicalFills = verified.flatMap(trade => trade.fills.map(fill => ({ fill, side: trade.ledger.side })))
    .sort((a, b) => a.fill.time - b.fill.time || (BigInt(a.fill.id) < BigInt(b.fill.id) ? -1 : 1));
  for (const { fill, side } of chronologicalFills) projectFill(position, side, fill, rules);
  for (const trade of verified) projectLegacy(legacy, trade, rules);
  assertLegacyNumber(bot.positionQty, legacy.qty, "Posición");
  assertLegacyNumber(bot.positionQty, position.qty, "Posición exacta", rules.stepSize);
  assertLegacyNumber(bot.positionAvgPrice, compare(legacy.qty, "0") === 0 ? "0" : divide(legacy.cost, legacy.qty), "Precio promedio");
  assertLegacyNumber(bot.investedUsdt, legacy.invested, "Inversión");
  const balances = account.balances.filter(balance => balance.asset === rules.baseAsset);
  if (balances.length > 1) throw new Error("Saldo de cuenta ambiguo; requiere revisión.");
  const balance = balances[0];
  const available = add(nonnegative(balance?.free ?? "0", "Saldo libre"), nonnegative(balance?.locked ?? "0", "Saldo bloqueado"));
  if (compare(available, position.qty) < 0) throw new Error("El saldo Binance es menor que la posición atribuida; requiere revisión.");
  return { exchangeAccountId: account.uid, tradingEnvironment: environment,
    positionQtyExact: position.qty, positionCostExact: position.cost, investedUsdtExact: position.invested };
}
