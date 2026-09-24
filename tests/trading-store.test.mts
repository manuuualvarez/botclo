import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createTradingStore } from "../src/lib/bot/trading-store";
import type { ExchangeFill, ExchangeOrder, NewExchangeOrder } from "../src/lib/binance/orders";

const url = process.env.BOTCLO_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/botclo_trading_test") {
  throw new Error("Usá node scripts/test-trading-db.mjs: estas pruebas requieren una base efímera exclusiva.");
}
const sql = postgres(url, { max: 5, onnotice: () => {} });
const store = createTradingStore(sql);
after(() => sql.end());
const context = { intervalMs: 60_000, reason: "Fixture de protección" };

async function robot(qty = 0, invested = 0) {
  const [row] = await sql`
    insert into bot_configs (user_id,strategy_id,symbol,budget_usdt,position_qty,position_avg_price,invested_usdt,position_qty_exact,position_cost_exact,invested_usdt_exact,trading_environment,exchange_account_id,recovery_state)
    values (${randomUUID()},'sma-cross','BTCUSDT',1000,${qty},${qty ? 100 : 0},${invested},${String(qty)},(${String(qty)}::numeric * 100)::text,${String(invested)},'testnet',${randomUUID()},'ready')
    returning *`;
  return row;
}
async function intent(bot: Awaited<ReturnType<typeof robot>>, side: "BUY" | "SELL" = "BUY", protect = false) {
  const id = randomUUID();
  const request: NewExchangeOrder = { symbol: "BTCUSDT", side, type: protect ? "STOP_LOSS" : "MARKET", clientOrderId: `test-${id.slice(0, 24)}`, ...(side === "BUY" ? { quoteOrderQty: "100" } : { quantity: String(bot.position_qty) }), ...(protect ? { stopPrice: "90" } : {}) };
  return store.createIntent({ id, botId: bot.id, userId: bot.user_id, environment: "testnet", accountId: bot.exchange_account_id, symbol: "BTCUSDT", action: protect ? "protect" : side === "BUY" ? "buy" : "sell", clientOrderId: request.clientOrderId, request });
}
function order(i: Awaited<ReturnType<typeof intent>>, overrides: Partial<ExchangeOrder> = {}): ExchangeOrder {
  return { symbol: i.symbol, orderId: "9007199254740991", clientOrderId: i.clientOrderId, side: i.request.side, type: i.request.type, origQty: "1", executedQty: "1", cummulativeQuoteQty: "100", status: "FILLED", updateTime: 1_780_000_000_000, ...overrides };
}
function fill(overrides: Partial<ExchangeFill> = {}): ExchangeFill {
  return { symbol: "BTCUSDT", id: "trade-1", orderId: "9007199254740991", qty: "1", quoteQty: "100", price: "100", commission: "0.001", commissionAsset: "BTC", time: 1_780_000_000_000, ...overrides };
}
async function position(id: number) { return (await sql`select * from bot_configs where id=${id}`)[0]; }
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`); }

test("migraciones desde cero incluyen columnas legacy omitidas y robots quedan legacy por default", async () => {
  const [bot] = await sql`insert into bot_configs (user_id,strategy_id,symbol,budget_usdt) values ('migration-fixture','dca','ETHUSDT',100) returning *`;
  assert.equal(bot.watched_candle_time, null);
  assert.equal(bot.recovery_state, "legacy");
  assert.match(bot.trading_id, /^[0-9a-f-]{36}$/);
  const [telegram] = await sql`insert into telegram_settings (user_id,bot_token_encrypted,chat_id) values ('migration-fixture','fake','fake') returning *`;
  assert.equal(telegram.candle_reports, false);
});

test("journal preserva identidad y bloquea borrar robot con intenciones", async () => {
  const bot = await robot(); const i = await intent(bot);
  assert.equal(i.state, "planned");
  assert.equal((await store.listIntents(bot.id))[0].id, i.id);
  await assert.rejects(store.createIntent({ ...i, id: randomUUID() }), (error: unknown) => error instanceof Error && error.cause instanceof Error && /unique|duplicate/i.test(error.cause.message));
  await assert.rejects(sql`delete from bot_configs where id=${bot.id}`, /foreign key/i);
  const updated = await store.updateIntent(i.id, { state: "unknown" });
  assert.equal(updated.state, "unknown");
});

test("BUY neto de comisión base se aplica una sola vez incluso con dos conexiones", async () => {
  const bot = await robot(); const i = await intent(bot);
  await Promise.all([store.applyOrderSnapshot(i.id, order(i), [fill()], context), store.applyOrderSnapshot(i.id, order(i), [fill()], context)]);
  const b = await position(bot.id);
  close(b.position_qty, 0.999); close(b.invested_usdt, 100); close(b.position_avg_price, 100 / 0.999);
  assert.equal((await store.listFills(i.id)).length, 1);
  assert.equal((await sql`select * from bot_trades where bot_id=${bot.id}`).length, 1);
});

test("fills parciales incrementales computan fees quote y BNB sin repetir el primer fill", async () => {
  const bot = await robot(); const i = await intent(bot);
  const first = fill({ qty: "0.4", quoteQty: "40", commission: "0.04", commissionAsset: "USDT" });
  await store.applyOrderSnapshot(i.id, order(i, { executedQty: "0.4", cummulativeQuoteQty: "40", status: "PARTIALLY_FILLED" }), [first], context);
  const second = fill({ id: "trade-2", qty: "0.6", quoteQty: "60", commission: "0.003", commissionAsset: "BNB" });
  await store.applyOrderSnapshot(i.id, order(i), [first, second], context);
  await store.applyOrderSnapshot(i.id, order(i), [first, second], context);
  const b = await position(bot.id);
  close(b.position_qty, 1); close(b.invested_usdt, 100.04); close(b.position_avg_price, 100.04);
  assert.equal((await store.listFills(i.id)).length, 2);
});

test("SELL por señal reduce presupuesto por producido neto sin agregar cooldown", async () => {
  const bot = await robot(1, 110); const i = await intent(bot, "SELL");
  await store.applyOrderSnapshot(i.id, order(i), [fill({ commission: "0.1", commissionAsset: "USDT" })], context);
  const b = await position(bot.id);
  close(b.position_qty, 0); close(b.invested_usdt, 10.1);
  assert.equal(b.position_avg_price, 0); assert.equal(b.stop_price, null);
  assert.equal(b.cooldown_until, null);
});

test("STOP_LOSS ejecutado deja cooldown desde el fill remoto aunque se concilie después", async () => {
  const bot = await robot(1, 110); const i = await intent(bot, "SELL", true);
  await store.applyOrderSnapshot(i.id, order(i), [fill({ commission: "0.1", commissionAsset: "USDT" })], context);
  const b = await position(bot.id);
  assert.equal(new Date(b.cooldown_until).getTime(), fill().time + context.intervalMs);
  assert.equal(b.position_qty_exact, "0");
});

test("STOP_LOSS pendiente persiste confirmación sin registrar operación ni mover posición", async () => {
  const bot = await robot(1, 100); const i = await intent(bot, "SELL", true);
  await store.applyOrderSnapshot(i.id, order(i, { status: "NEW", executedQty: "0", cummulativeQuoteQty: "0", stopPrice: "90" }), [], context);
  const b = await position(bot.id);
  close(b.position_qty, 1); close(b.invested_usdt, 100);
  assert.equal(b.protection_intent_id, i.id); assert.equal(b.confirmed_stop_price, "90");
  assert.equal((await sql`select * from bot_trades where bot_id=${bot.id}`).length, 0);
});

test("saldo ajeno no cubre SELL+fee mayor que propiedad: rollback de journal y posición", async () => {
  const bot = await robot(1, 100); const i = await intent(bot, "SELL");
  await assert.rejects(store.applyOrderSnapshot(i.id, order(i), [fill()], context), /posición|position|propiedad/i);
  assert.equal((await store.listFills(i.id)).length, 0);
  assert.equal((await position(bot.id)).position_qty, 1);
});

test("fills incompletos y snapshot de otro símbolo no producen contabilidad parcial", async () => {
  const bot = await robot(); const i = await intent(bot);
  await assert.rejects(store.applyOrderSnapshot(i.id, order(i), [fill({ qty: "0.5", quoteQty: "50" })], context), /fill|cantidad|quantity/i);
  await assert.rejects(store.applyOrderSnapshot(i.id, order(i, { symbol: "ETHUSDT" }), [fill()], context), /identidad|identity|symbol/i);
  assert.equal((await store.listFills(i.id)).length, 0);
  assert.equal((await position(bot.id)).position_qty, 0);
});

test("mismo trade ID con contenido diferente se rechaza y estado terminal no retrocede", async () => {
  const bot = await robot(); const i = await intent(bot);
  await store.applyOrderSnapshot(i.id, order(i), [fill()], context);
  await assert.rejects(store.applyOrderSnapshot(i.id, order(i), [fill({ commission: "0.002" })], context), /fill|trade|distint/i);
  await store.applyOrderSnapshot(i.id, order(i, { status: "NEW", executedQty: "0", cummulativeQuoteQty: "0", updateTime: 1 }), [], context);
  assert.equal((await store.listIntents(bot.id))[0].state, "filled");
  close((await position(bot.id)).position_qty, 0.999);
});

test("account/environment del robot debe coincidir antes de crear o aplicar una intención", async () => {
  const bot = await robot(); const i = await intent(bot);
  await sql`update bot_configs set exchange_account_id='other-account' where id=${bot.id}`;
  await assert.rejects(store.applyOrderSnapshot(i.id, order(i), [fill()], context), /cuenta|account|identidad|identity/i);
  assert.equal((await store.listFills(i.id)).length, 0);
});

test("cantidades decimales permanecen exactas: 0.1 + 0.2 = 0.3", async () => {
  const bot = await robot(); const i = await intent(bot);
  await store.applyOrderSnapshot(i.id, order(i, { executedQty: "0.3", cummulativeQuoteQty: "30" }), [
    fill({ id: "a", qty: "0.1", quoteQty: "10", commission: "0" }),
    fill({ id: "b", qty: "0.2", quoteQty: "20", commission: "0" }),
  ], context);
  const b = await position(bot.id);
  assert.equal(b.position_qty_exact, "0.3");
  assert.equal(b.position_cost_exact, "30");
  assert.equal(b.invested_usdt_exact, "30");
});

test("cancelar stop anterior no borra la confirmación de un reemplazo", async () => {
  const bot = await robot(1, 100); const first = await intent(bot, "SELL", true); const next = await intent(bot, "SELL", true);
  await store.applyOrderSnapshot(first.id, order(first, { status: "NEW", executedQty: "0", cummulativeQuoteQty: "0", stopPrice: "90" }), [], context);
  await store.applyOrderSnapshot(next.id, order(next, { orderId: "9223372036854775806", status: "NEW", executedQty: "0", cummulativeQuoteQty: "0", stopPrice: "95" }), [], context);
  await store.applyOrderSnapshot(first.id, order(first, { status: "CANCELED", executedQty: "0", cummulativeQuoteQty: "0", stopPrice: "90" }), [], context);
  assert.equal((await position(bot.id)).protection_intent_id, next.id);
  assert.equal((await position(bot.id)).confirmed_stop_price, "95");
});

test("PENDING_NEW y PENDING_CANCEL no se presentan como protección confirmada", async () => {
  for (const status of ["PENDING_NEW", "PENDING_CANCEL"]) {
    const bot = await robot(1, 100); const i = await intent(bot, "SELL", true);
    await store.applyOrderSnapshot(i.id, order(i, { status, executedQty: "0", cummulativeQuoteQty: "0", stopPrice: "90" }), [], context);
    assert.equal((await store.listIntents(bot.id))[0].state, "unknown");
    assert.equal((await position(bot.id)).confirmed_stop_price, null);
  }
});

test("SELL FILLED termina el ciclo y conserva dust exacto/costo sin inventar saldo", async () => {
  for (const protect of [true, false]) {
    const bot = await robot(1.0004, 100.04);
    const i = await intent({ ...bot, position_qty: 1 }, "SELL", protect);
    await sql`update bot_configs set stop_price=90,highest_close=110 where id=${bot.id}`;
    if (protect) await store.applyOrderSnapshot(i.id, order(i, { status: "NEW", executedQty: "0", cummulativeQuoteQty: "0", stopPrice: "90" }), [], context);
    await store.applyOrderSnapshot(i.id, order(i), [fill({ commission: "0.1", commissionAsset: "USDT" })], context);
    const b = await position(bot.id);
    assert.equal(b.position_qty_exact, "0.0004");
    assert.equal(b.position_cost_exact, "0.04");
    assert.equal(b.invested_usdt_exact, "0.14");
    assert.equal(b.stop_price, null);
    assert.equal(b.highest_close, null);
    assert.equal(b.protection_intent_id, null);
    assert.equal(b.confirmed_stop_price, null);
    assert.equal(b.cooldown_until === null ? null : new Date(b.cooldown_until).getTime(), protect ? fill().time + context.intervalMs : null);
  }
});

test("finalizar SELL sin fills nuevos limpia el ciclo una vez, no la protección posterior", async () => {
  const bot = await robot(1.0004, 100.04); const i = await intent({ ...bot, position_qty: 1 }, "SELL", true);
  await sql`update bot_configs set stop_price=90,highest_close=110 where id=${bot.id}`;
  const f = fill({ commission: "0", commissionAsset: "USDT" });
  await store.applyOrderSnapshot(i.id, order(i, { status: "PARTIALLY_FILLED", stopPrice: "90" }), [f], context);
  const applied = await store.applyOrderSnapshot(i.id, order(i), [f], context);
  assert.equal(applied.newFillCount, 0);
  assert.equal((await position(bot.id)).stop_price, null);
  const next = await intent(bot, "SELL", true);
  await sql`update bot_configs set stop_price=95,highest_close=120 where id=${bot.id}`;
  await store.applyOrderSnapshot(next.id, order(next, { orderId: "9001", status: "NEW", executedQty: "0", cummulativeQuoteQty: "0", stopPrice: "95" }), [], context);
  await store.applyOrderSnapshot(i.id, order(i), [f], context);
  const b = await position(bot.id);
  assert.equal(b.stop_price, 95); assert.equal(b.highest_close, 120);
  assert.equal(b.protection_intent_id, next.id); assert.equal(b.confirmed_stop_price, "95");
});

test("MARKET por stop ya cruzado conserva cooldown de stop desde tiempo remoto", async () => {
  const bot = await robot(1, 100); const i = await intent(bot, "SELL");
  await store.updateIntent(i.id, { metadata: { exitReason: "stop" } });
  await store.applyOrderSnapshot(i.id, order(i), [fill({ commission: "0", commissionAsset: "USDT" })], context);
  assert.equal(new Date((await position(bot.id)).cooldown_until).getTime(), fill().time + context.intervalMs);
});

test("cancelReplace puede renombrar clientOrderId sólo después de vincular orderId exacto", async () => {
  const bot = await robot(1, 100); const i = await intent(bot, "SELL", true);
  const open = order(i, { status: "NEW", executedQty: "0", cummulativeQuoteQty: "0", stopPrice: "90" });
  await assert.rejects(store.applyOrderSnapshot(i.id, { ...open, clientOrderId: "binance-cancel-renamed" }, [], context), /identidad/i);
  await store.applyOrderSnapshot(i.id, open, [], context);
  await assert.rejects(store.applyOrderSnapshot(i.id, { ...open, orderId: "987654321", clientOrderId: "binance-cancel-renamed", status: "CANCELED" }, [], context), /identidad/i);
  await store.applyOrderSnapshot(i.id, { ...open, clientOrderId: "binance-cancel-renamed", status: "CANCELED" }, [], context);
  const [saved] = await store.listIntents(bot.id);
  assert.equal(saved.state, "canceled");
  assert.equal(saved.clientOrderId, i.clientOrderId);
  assert.equal(saved.exchangeOrderId, open.orderId);
  assert.equal((await position(bot.id)).protection_intent_id, null);
  assert.equal((await position(bot.id)).position_qty_exact, "1");
});
