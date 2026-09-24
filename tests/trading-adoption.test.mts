import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExchangeAccount, ExchangeFill, ExchangeOrder, ExchangeRules } from "../src/lib/binance/orders";
import { prepareLegacyAdoption, type LegacyBot, type LegacyTrade } from "../src/lib/bot/trading-adoption";

const pair = "BTCUSDT";
const orderId = "9007199254740993123";
const accountId = "9007199254740993999";
const rules: ExchangeRules = { symbol: pair, baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING",
  quoteAssetPrecision: 8, orderTypes: ["MARKET", "STOP_LOSS"], cancelReplaceAllowed: true,
  minQty: "0.00001", maxQty: "100", stepSize: "0.00001", minPrice: "0.01", maxPrice: "1000000",
  tickSize: "0.01", minNotional: "5", maxNotional: "1000000", applyMinToMarket: true,
  applyMaxToMarket: true, avgPriceMins: 5 };

function fixture() {
  const bot: LegacyBot = { symbol: pair, positionQty: 0.999, positionAvgPrice: 100 / 0.999, investedUsdt: 100 };
  const trades: LegacyTrade[] = [{ symbol: pair, side: "BUY", qty: 0.999, quoteQty: 100,
    binanceOrderId: orderId, isTestnet: true }];
  const orders: ExchangeOrder[] = [{ symbol: pair, orderId, clientOrderId: "legacy-buy", side: "BUY", type: "MARKET",
    status: "FILLED", origQty: "1", executedQty: "1", cummulativeQuoteQty: "100", updateTime: 1000 }];
  const fills: ExchangeFill[] = [{ id: "9007199254740994000", symbol: pair, orderId, price: "100", qty: "1",
    quoteQty: "100", commission: "0.001", commissionAsset: "BTC", time: 1000 }];
  const account: ExchangeAccount = { uid: accountId, balances: [{ asset: "BTC", free: "20", locked: "10" }] };
  const calls: string[] = [];
  const exchange = {
    environment: "testnet" as "testnet" | "mainnet",
    getAccount: async () => { calls.push("account"); return account; },
    getRules: async (symbol: string) => { assert.equal(symbol, pair); calls.push("rules"); return rules; },
    getOrder: async (symbol: string, lookup: { orderId?: string; clientOrderId?: string }) => {
      assert.equal(symbol, pair); assert.equal(typeof lookup.orderId, "string");
      calls.push(`order:${lookup.orderId}`);
      return orders.find(order => order.orderId === lookup.orderId) ?? null;
    },
    listTrades: async (symbol: string, id: string) => {
      assert.equal(symbol, pair); calls.push(`fills:${id}`); return fills.filter(fill => fill.orderId === id);
    },
  };
  const prepare = () => prepareLegacyAdoption({ bot, trades, exchange, environment: "testnet" });
  return { bot, trades, orders, fills, account, calls, exchange, prepare };
}

function sell(f: ReturnType<typeof fixture>, qty = "0.999", quote = "90", commission = "0.09", asset = "USDT") {
  const id = "9007199254740993124";
  f.trades.push({ symbol: pair, side: "SELL", qty: Number(qty), quoteQty: Number(quote) - (asset === "USDT" ? Number(commission) : 0), binanceOrderId: id, isTestnet: true });
  f.orders.push({ ...f.orders[0], orderId: id, clientOrderId: "legacy-sell", side: "SELL", origQty: qty, executedQty: qty, cummulativeQuoteQty: quote, updateTime: 2000 });
  f.fills.push({ ...f.fills[0], id: "9007199254740994001", orderId: id, qty, quoteQty: quote, price: "90", commission, commissionAsset: asset, time: 2000 });
  f.bot.positionQty = 0; f.bot.positionAvgPrice = 0;
  f.bot.investedUsdt = Math.max(0, 100 - f.trades[1].quoteQty);
}

test("adopta solo cantidad atribuida, neta de fee base, conserva UID y order IDs int64", async () => {
  const f = fixture();
  assert.deepEqual(await f.prepare(), { exchangeAccountId: accountId, tradingEnvironment: "testnet",
    positionQtyExact: "0.999", positionCostExact: "100", investedUsdtExact: "100" });
  assert.ok(f.calls.includes(`order:${orderId}`));
  assert.equal(f.bot.positionQty, 0.999);
  assert.equal(f.trades.length, 1);
});

test("fees quote suman costo e inversión exactos sin confundir la contabilidad legacy", async () => {
  const f = fixture();
  f.fills[0].commission = "0.1"; f.fills[0].commissionAsset = "USDT";
  f.trades[0].qty = 1; f.bot.positionQty = 1; f.bot.positionAvgPrice = 100;
  const plan = await f.prepare();
  assert.equal(plan.positionCostExact, "100.1"); assert.equal(plan.investedUsdtExact, "100.1");
});

test("fees BNB no se convierten a USDT sin precio de conversión", async () => {
  const f = fixture(); f.fills[0].commissionAsset = "BNB";
  f.trades[0].qty = 1; f.bot.positionQty = 1; f.bot.positionAvgPrice = 100;
  assert.equal((await f.prepare()).positionCostExact, "100");
});

test("SELL reduce inversión por producido neto y reconstruye en orden remoto aunque ledger venga invertido", async () => {
  const f = fixture(); sell(f); f.trades.reverse();
  const plan = await f.prepare();
  assert.equal(plan.positionQtyExact, "0"); assert.equal(plan.positionCostExact, "0");
  assert.equal(plan.investedUsdtExact, "10.09");
});

test("venta con ganancia deja inversión consumida en cero", async () => {
  const f = fixture(); sell(f, "0.999", "120", "0.12");
  assert.equal((await f.prepare()).investedUsdtExact, "0");
});

test("polvo probado por historial menor a step se conserva sin tomar saldo de la cuenta", async () => {
  const f = fixture(); sell(f, "0.99899999");
  const plan = await f.prepare();
  assert.equal(plan.positionQtyExact, "0.00000001");
  assert.notEqual(plan.positionCostExact, "0");
});

test("robot vacío sin historial solo admite inversión consumida cero", async () => {
  const f = fixture(); f.trades.length = 0;
  f.bot.positionQty = 0; f.bot.positionAvgPrice = 0; f.bot.investedUsdt = 0;
  assert.deepEqual(await f.prepare(), { exchangeAccountId: accountId, tradingEnvironment: "testnet",
    positionQtyExact: "0", positionCostExact: "0", investedUsdtExact: "0" });
  assert.equal(f.calls.filter(call => call.startsWith("order:")).length, 0);
  f.bot.investedUsdt = 1;
  await assert.rejects(f.prepare(), /historial|inversión/i);
});

test("posición abierta sin historial nunca se infiere del balance", async () => {
  const f = fixture(); f.trades.length = 0;
  await assert.rejects(f.prepare(), /historial/i);
});

test("rechaza claves de entorno distinto antes de leer la cuenta", async () => {
  const f = fixture(); f.exchange.environment = "mainnet";
  await assert.rejects(f.prepare(), /entorno/i); assert.equal(f.calls.length, 0);
});

for (const change of [
  (f: ReturnType<typeof fixture>) => { f.trades[0].binanceOrderId = null; },
  (f: ReturnType<typeof fixture>) => { f.trades[0].binanceOrderId = "9.1"; },
  (f: ReturnType<typeof fixture>) => { f.trades.push({ ...f.trades[0] }); },
  (f: ReturnType<typeof fixture>) => { f.trades[0].isTestnet = false; },
  (f: ReturnType<typeof fixture>) => { f.trades[0].symbol = "ETHUSDT"; },
  (f: ReturnType<typeof fixture>) => { f.trades[0].side = "SELL"; },
  (f: ReturnType<typeof fixture>) => { f.trades[0].qty = 0.998; },
  (f: ReturnType<typeof fixture>) => { f.trades[0].quoteQty = 99; },
]) {
  test(`ledger no atribuible bloquea adopción: ${change.toString()}`, async () => {
    const f = fixture(); change(f); await assert.rejects(f.prepare());
  });
}

test("orden remota ausente, abierta o sin fills completos requiere revisión", async () => {
  for (const problem of ["missing", "open", "fills"] as const) {
    const f = fixture();
    if (problem === "missing") f.orders.length = 0;
    if (problem === "open") f.orders[0].status = "PARTIALLY_FILLED";
    if (problem === "fills") f.fills[0].qty = "0.5";
    await assert.rejects(f.prepare(), /orden|fill|historial/i);
  }
});

test("fill duplicado o de otro símbolo no puede inflar baseline", async () => {
  for (const problem of ["duplicate", "symbol"] as const) {
    const f = fixture();
    if (problem === "duplicate") f.fills.push({ ...f.fills[0] });
    else f.fills[0].symbol = "ETHUSDT";
    await assert.rejects(f.prepare(), /fill|identidad/i);
  }
});

test("SELL no puede consumir cantidad no demostrada aunque exista saldo ajeno", async () => {
  const f = fixture(); sell(f, "1", "100", "0", "USDT");
  await assert.rejects(f.prepare(), /venta|posición|atribuida/i);
});

test("saldo menor que propiedad, incluyendo locked, requiere revisión", async () => {
  const f = fixture(); f.account.balances[0] = { asset: "BTC", free: "0.9", locked: "0.09" };
  await assert.rejects(f.prepare(), /saldo/i);
});

test("deriva de qty, costo promedio o inversión legacy bloquea baseline", async () => {
  for (const field of ["positionQty", "positionAvgPrice", "investedUsdt"] as const) {
    const f = fixture(); f.bot[field] += 1;
    await assert.rejects(f.prepare(), /legacy|historial|posición|inversión/i);
  }
});

test("redondeo IEEE754 mínimo se acepta pero baseline conserva decimal exacto", async () => {
  const f = fixture(); f.bot.positionQty += Number.EPSILON;
  f.trades[0].qty += Number.EPSILON; f.bot.investedUsdt += Number.EPSILON * 100;
  assert.equal((await f.prepare()).positionQtyExact, "0.999");
});

test("múltiples fills ordenados por trade ID reconstruyen 0.1 + 0.2 exactos", async () => {
  const f = fixture();
  f.bot.positionQty = 0.1 + 0.2; f.bot.positionAvgPrice = 100; f.bot.investedUsdt = 30;
  f.trades[0].qty = 0.1 + 0.2; f.trades[0].quoteQty = 30;
  f.orders[0].origQty = "0.3"; f.orders[0].executedQty = "0.3"; f.orders[0].cummulativeQuoteQty = "30";
  const first = { ...f.fills[0], qty: "0.1", quoteQty: "10", commission: "0" };
  const second = { ...first, id: "9007199254740994001", qty: "0.2", quoteQty: "20" };
  f.fills.splice(0, 1, second, first);
  assert.equal((await f.prepare()).positionQtyExact, "0.3");
});

test("fee base de SELL consume propiedad y nunca se cubre con saldo externo", async () => {
  const f = fixture(); sell(f, "0.999", "90", "0.001", "BTC");
  await assert.rejects(f.prepare(), /venta|posición|atribuida/i);
});
