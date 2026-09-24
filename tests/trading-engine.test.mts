import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createTradingEngine, clientOrderPrefix } from "../src/lib/bot/trading-engine";
import type { TradingIntent, CreateTradingIntent } from "../src/lib/bot/trading-store";
import { add, compare, divide, multiply, subtract } from "../src/lib/binance/decimal";
import { BinanceOrderError, UnknownExecutionError, type ExchangeFill, type ExchangeOrder, type NewExchangeOrder } from "../src/lib/binance/orders";

type Dependencies = Parameters<typeof createTradingEngine>[0];
type EngineBot = Awaited<ReturnType<Dependencies["loadBot"]>>;
const METADATA = { reason: "signal", intervalMs: 3_600_000, protection: { atr: null, stopMultiple: 2 } };

// Exchange con estado propio: acepta antes de perder respuesta y puede llenar
// el stop justo antes del reemplazo. La contabilidad real del store se prueba
// además en PostgreSQL; acá solo se aplican fills nuevos al doble en memoria.
function fixture() {
  const bot: EngineBot & { cooldownUntil: Date | null } = {
    id: 1, userId: "u", tradingId: randomUUID(), symbol: "BTCUSDT", status: "active",
    tradingEnvironment: "testnet", exchangeAccountId: "123", recoveryState: "ready", recoveryReason: null,
    positionQtyExact: "0", positionCostExact: "0", investedUsdtExact: "0", stopPrice: null,
    confirmedStopPrice: null, protectionIntentId: null, lastReconciledAt: new Date(1000), createdAt: new Date(1000), cooldownUntil: null,
  };
  const intents: TradingIntent[] = [];
  const remote = new Map<string, ExchangeOrder>();
  const remoteFills = new Map<string, ExchangeFill[]>();
  const appliedFills = new Set<string>();
  const calls: NewExchangeOrder[] = [];
  const replaceCalls: Parameters<Dependencies["exchange"]["cancelReplace"]>[0][] = [];
  const balances = [{ asset: "BTC", free: "10", locked: "0" }];
  let loseReply = false;
  let nullQueries = false;
  let crashSavingStop = false;
  let accountId = "123";
  let buyFee = { amount: "0", asset: "USDT" };
  let replacement: "normal" | "stopFilled" | "rejectNew" | "loseReply" = "normal";
  let orderSequence = 0;

  function complete(order: ExchangeOrder, qty = order.origQty, status = "FILLED", fee = { amount: "0", asset: "USDT" }) {
    order.executedQty = qty; order.cummulativeQuoteQty = multiply(qty, "100"); order.status = status;
    remoteFills.set(order.orderId, [{ id: order.orderId, orderId: order.orderId, symbol: order.symbol, price: "100", qty,
      quoteQty: order.cummulativeQuoteQty, commission: fee.amount, commissionAsset: fee.asset, time: 2000 }]);
  }
  function accept(request: NewExchangeOrder) {
    const order: ExchangeOrder = {
      symbol: request.symbol, clientOrderId: request.clientOrderId, side: request.side, type: request.type,
      orderId: String(++orderSequence), origQty: request.quantity ?? divide(request.quoteOrderQty!, "100"),
      executedQty: "0", cummulativeQuoteQty: "0", status: "NEW", stopPrice: request.stopPrice, updateTime: 2000,
    };
    calls.push(structuredClone(request)); remote.set(request.clientOrderId, order);
    if (request.type === "MARKET") complete(order, order.origQty, "FILLED", request.side === "BUY" ? buyFee : undefined);
    return structuredClone(order);
  }
  const exchange: Dependencies["exchange"] = {
    getAccount: async () => ({ uid: accountId, balances: structuredClone(balances) }),
    getLastPrice: async () => "100",
    getRules: async () => ({ symbol: "BTCUSDT", orderTypes: ["MARKET", "STOP_LOSS"], tickSize: "0.01", stepSize: "0.0001",
      minQty: "0.0001", maxQty: "100", minPrice: "0.01", maxPrice: "10000000", minNotional: "5", maxNotional: "0",
      baseAsset: "BTC", quoteAsset: "USDT", quoteAssetPrecision: 8, avgPriceMins: 5, cancelReplaceAllowed: true,
      status: "TRADING", marketLotSize: { stepSize: "0", minQty: "0", maxQty: "100" }, applyMinToMarket: true, applyMaxToMarket: false }),
    listOrders: async () => structuredClone([...remote.values()]),
    getOrder: async (_symbol, ref) => nullQueries ? null : structuredClone([...remote.values()]
      .find(order => order.clientOrderId === ref.clientOrderId || order.orderId === ref.orderId) ?? null),
    listTrades: async (_symbol, id) => structuredClone(remoteFills.get(id) ?? []),
    placeOrder: async (request) => {
      assert.equal(intents.at(-1)?.state, "submitting", "la intención debe ser durable antes del envío");
      const order = accept(request);
      if (loseReply) { loseReply = false; throw new UnknownExecutionError(); }
      return order;
    },
    cancelReplace: async (input) => {
      replaceCalls.push(structuredClone(input));
      const old = [...remote.values()].find(order => order.orderId === input.orderId); assert.ok(old);
      if (replacement === "stopFilled") { complete(old); replacement = "normal"; }
      // Modela cancelRestrictions=ONLY_NEW con saldo manual extra disponible.
      if (old.status !== "NEW") return { cancelResult: "FAILURE", newOrderResult: "NOT_ATTEMPTED", cancelError: { code: -2011, message: "not new" } };
      old.status = "CANCELED";
      const canceledResponse = structuredClone(old);
      // Binance renombra la cancelada; sólo la respuesta inmediata contiene
      // origClientOrderId. Luego GET por el client ID anterior devuelve -2013.
      remote.delete(old.clientOrderId); old.clientOrderId = `cancel_${old.orderId}`; remote.set(old.clientOrderId, old);
      if (replacement === "rejectNew") return { cancelResult: "SUCCESS", newOrderResult: "FAILURE", canceledOrder: canceledResponse, newOrderError: { code: -2010, message: "rejected" } };
      const next = accept(input.newOrder);
      if (replacement === "loseReply") { replacement = "normal"; throw new UnknownExecutionError(); }
      return { cancelResult: "SUCCESS", newOrderResult: "SUCCESS", canceledOrder: canceledResponse, newOrder: next };
    },
  };
  const store: Dependencies["store"] = {
    listIntents: async () => structuredClone(intents),
    createIntent: async (input: CreateTradingIntent) => {
      const row: TradingIntent = { ...input, state: "planned", executedQty: "0", quoteQty: "0", stopPrice: null,
        metadata: input.metadata ?? {}, replacesIntentId: input.replacesIntentId ?? null, exchangeOrderId: null,
        createdAt: new Date(1000 + intents.length), updatedAt: new Date(1000) };
      intents.push(row); return structuredClone(row);
    },
    updateIntent: async (id, patch) => {
      const row = intents.find(intent => intent.id === id); assert.ok(row);
      Object.assign(row, patch); return structuredClone(row);
    },
    applyOrderSnapshot: async (id, order, fills, context) => {
      const row = intents.find(intent => intent.id === id); assert.ok(row);
      assert.equal(order.symbol, row.symbol); assert.equal(order.side, row.request.side); assert.equal(order.type, row.request.type);
      if (row.exchangeOrderId === null) assert.equal(order.clientOrderId, row.clientOrderId);
      else assert.equal(order.orderId, row.exchangeOrderId, "la identidad exchange prevalece tras renombrar la cancelada");
      let newFillCount = 0;
      for (const fill of fills) {
        const key = `${id}:${fill.id}`;
        if (appliedFills.has(key)) continue;
        const baseFee = fill.commissionAsset === "BTC" ? fill.commission : "0";
        const quoteFee = fill.commissionAsset === "USDT" ? fill.commission : "0";
        if (order.side === "BUY") {
          bot.positionQtyExact = add(bot.positionQtyExact, subtract(fill.qty, baseFee));
          bot.positionCostExact = add(bot.positionCostExact, add(fill.quoteQty, quoteFee));
          bot.investedUsdtExact = add(bot.investedUsdtExact, add(fill.quoteQty, quoteFee));
        } else {
          const consumed = add(fill.qty, baseFee);
          assert.ok(compare(consumed, bot.positionQtyExact) <= 0, "la venta remota excedió posición propia");
          const remaining = subtract(bot.positionQtyExact, consumed);
          bot.positionCostExact = divide(multiply(bot.positionCostExact, remaining), bot.positionQtyExact);
          bot.positionQtyExact = remaining;
          const after = subtract(bot.investedUsdtExact, subtract(fill.quoteQty, quoteFee));
          bot.investedUsdtExact = compare(after, "0") < 0 ? "0" : after;
          if (remaining === "0" || order.status === "FILLED") {
            bot.stopPrice = null; bot.confirmedStopPrice = null; bot.protectionIntentId = null;
            if (order.type === "STOP_LOSS" || row.metadata.exitReason === "stop") bot.cooldownUntil = new Date(fill.time + context.intervalMs);
          }
        }
        appliedFills.add(key); newFillCount++;
      }
      Object.assign(row, { state: order.status === "FILLED" ? "filled" : order.status === "CANCELED" ? "canceled" : "open",
        exchangeOrderId: order.orderId, executedQty: order.executedQty, quoteQty: order.cummulativeQuoteQty, stopPrice: order.stopPrice ?? null });
      if (order.type === "STOP_LOSS") {
        if (row.state === "open") { bot.confirmedStopPrice = order.stopPrice ?? null; bot.protectionIntentId = id; }
        else if (bot.protectionIntentId === id) { bot.confirmedStopPrice = null; bot.protectionIntentId = null; }
      }
      return { intent: structuredClone(row), newFillCount };
    },
  };
  const engine = () => createTradingEngine({ exchange, store, loadBot: async () => structuredClone(bot),
    saveBot: async (patch) => {
      if (crashSavingStop && patch.stopPrice !== undefined) { crashSavingStop = false; throw new Error("process died after BUY commit"); }
      Object.assign(bot, patch);
    }, now: () => new Date(3000) });
  return { bot, intents, remote, remoteFills, calls, replaceCalls, exchange, store, engine, complete, balances,
    appliedFills, loseReply: () => { loseReply = true; }, nullQueries: () => { nullQueries = true; },
    wrongAccount: () => { accountId = "999"; }, failStopSave: () => { crashSavingStop = true; },
    fee: (amount: string, asset: string) => { buyFee = { amount, asset }; }, replacement: (mode: typeof replacement) => { replacement = mode; } };
}

test("client IDs codifican identidad durable y caben en Binance", () => {
  const prefix = clientOrderPrefix("00000000-0000-0000-0000-000000000001");
  assert.equal(prefix.length, 26); assert.notEqual(prefix, clientOrderPrefix(randomUUID()));
});
test("BUY aceptado con respuesta perdida se concilia sin recomprar", async () => {
  const f = fixture(); f.loseReply();
  await assert.rejects(f.engine().buy("100", METADATA)); assert.equal(f.intents[0].state, "unknown");
  await f.engine().reconcile();
  assert.equal(f.calls.filter(call => call.side === "BUY").length, 1);
  assert.equal(f.bot.positionQtyExact, "1"); assert.equal(f.bot.stopPrice, 92);
  await f.engine().protect(); assert.equal(f.calls[1].type, "STOP_LOSS"); assert.equal(f.calls[1].stopPrice, "92");
});
test("orden desconocida todavía no visible bloquea reenvío", async () => {
  const f = fixture(); f.loseReply();
  await assert.rejects(f.engine().buy("100", METADATA)); f.nullQueries();
  await assert.rejects(f.engine().reconcile()); await assert.rejects(f.engine().buy("100", METADATA)); assert.equal(f.calls.length, 1);
});
test("cuenta distinta bloquea toda orden", async () => {
  const f = fixture(); f.wrongAccount();
  await assert.rejects(f.engine().buy("100", METADATA)); assert.equal(f.calls.length, 0);
});
test("backup sin intención de una orden propia exige revisión", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA); f.intents.splice(0, f.intents.length);
  await assert.rejects(f.engine().reconcile(), /ausente del backup/);
  assert.equal(f.bot.recoveryState, "review"); assert.equal(f.calls.length, 2);
});
test("pausa concilia fill remoto y bloquea nuevas compras", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA); f.bot.status = "paused";
  const stop = [...f.remote.values()].find(order => order.type === "STOP_LOSS")!; f.complete(stop);
  await f.engine().reconcile(); assert.equal(f.bot.positionQtyExact, "0");
  await assert.rejects(f.engine().buy("100", METADATA)); assert.equal(f.calls.length, 2);
});
test("configuración sin stop no inventa protección", async () => {
  const f = fixture(); f.bot.positionQtyExact = "1"; await f.engine().protect(); assert.equal(f.calls.length, 0);
});
test("stop confirmado idéntico no se reemplaza en cada tick", async () => {
  const f = fixture(); f.bot.positionQtyExact = "1"; f.bot.stopPrice = 90;
  await f.engine().protect(); await f.engine().protect(); assert.equal(f.calls.length, 1);
});
test("stop se llena justo antes de venta por señal: no sale otra venta", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA); f.replacement("stopFilled");
  await assert.rejects(f.engine().sell(METADATA));
  assert.equal(f.calls.filter(call => call.type === "MARKET" && call.side === "SELL").length, 0);
  assert.equal(f.bot.positionQtyExact, "0");
  await f.engine().reconcile(); await f.engine().sell(METADATA); assert.equal(f.calls.length, 2);
});
test("cancelación exitosa + reemplazo rechazado deja cobertura ausente explícita", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA); f.bot.stopPrice = 95; f.replacement("rejectNew");
  await assert.rejects(f.engine().protect());
  assert.equal(f.bot.positionQtyExact, "1"); assert.equal(f.bot.confirmedStopPrice, null);
  assert.equal(f.intents.at(-1)?.state, "rejected"); assert.equal(f.bot.recoveryState, "review");
  await assert.rejects(f.engine().buy("100", METADATA));
});
test("timeout tras reemplazo aceptado recupera nueva protección sin duplicarla", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA); f.bot.stopPrice = 95; f.replacement("loseReply");
  await assert.rejects(f.engine().protect()); assert.equal(f.intents.at(-1)?.state, "unknown");
  await f.engine().reconcile(); await f.engine().protect();
  assert.equal(f.bot.confirmedStopPrice, "95"); assert.equal(f.calls.length, 3); assert.equal(f.replaceCalls.length, 1);
});
test("timeout de venta reemplazada concilia la cancelada renombrada y el MARKET ejecutado", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA);
  const original = structuredClone(f.intents[1]); assert.ok(original.exchangeOrderId);
  f.replacement("loseReply"); await assert.rejects(f.engine().sell(METADATA), UnknownExecutionError);
  assert.equal(await f.exchange.getOrder("BTCUSDT", { clientOrderId: original.clientOrderId }), null);
  const canceled = await f.exchange.getOrder("BTCUSDT", { orderId: original.exchangeOrderId });
  assert.equal(canceled?.status, "CANCELED"); assert.notEqual(canceled?.clientOrderId, original.clientOrderId);
  assert.equal(f.bot.positionQtyExact, "1", "la respuesta perdida aún no aplicó la venta localmente");
  await f.engine().reconcile(); await f.engine().sell(METADATA);
  assert.equal(f.bot.positionQtyExact, "0"); assert.equal(f.bot.recoveryState, "ready");
  assert.equal(f.intents[1].state, "canceled"); assert.equal(f.intents[2].state, "filled");
  assert.equal(f.calls.filter(call => call.side === "SELL" && call.type === "MARKET").length, 1);
});
test("caída tras commit de BUY y antes de guardar stop recupera política durable", async () => {
  const f = fixture(); f.failStopSave(); await assert.rejects(f.engine().buy("100", METADATA));
  assert.equal(f.intents[0].state, "filled"); assert.equal(f.bot.stopPrice, null);
  await f.engine().reconcile(); await f.engine().protect();
  assert.equal(f.bot.stopPrice, 92); assert.equal(f.calls.length, 2); assert.equal(f.bot.positionQtyExact, "1");
});
test("venta total de lo operable conserva dust sin recrear un stop imposible", async () => {
  const f = fixture(); f.fee("0.00015", "BTC"); await f.engine().buy("100", METADATA);
  assert.equal(f.calls[1].quantity, "0.9998"); assert.equal(f.bot.positionQtyExact, "0.99985");
  const stop = [...f.remote.values()].find(order => order.type === "STOP_LOSS")!; f.complete(stop);
  await f.engine().reconcile(); assert.equal(f.bot.positionQtyExact, "0.00005"); assert.equal(f.bot.confirmedStopPrice, null);
  assert.equal(f.bot.stopPrice, null, "el BUY histórico no reabre el stop tras SELL terminal");
  assert.equal(f.bot.cooldownUntil?.getTime(), 2000 + METADATA.intervalMs);
  await f.engine().protect(); await f.engine().reconcile();
  assert.equal(f.bot.positionQtyExact, "0.00005"); assert.equal(f.bot.stopPrice, null);
  assert.equal(f.bot.recoveryState, "ready"); assert.equal(f.calls.length, 2);
});
test("stop hereda intervalo de cooldown y replay no lo corre hacia adelante", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA); assert.equal(f.intents[1].metadata.intervalMs, METADATA.intervalMs);
  const stop = [...f.remote.values()].find(order => order.type === "STOP_LOSS")!; f.complete(stop);
  await f.engine().reconcile(); const expected = 2000 + METADATA.intervalMs;
  assert.equal(f.bot.cooldownUntil?.getTime(), expected); await f.engine().reconcile(); assert.equal(f.bot.cooldownUntil?.getTime(), expected);
});
test("backup con intención planned pero BUY ya ejecutado no descarta la compra", async () => {
  const f = fixture(); f.loseReply(); await assert.rejects(f.engine().buy("100", METADATA)); f.intents[0].state = "planned";
  await f.engine().reconcile(); assert.equal(f.intents[0].state, "filled"); assert.equal(f.bot.positionQtyExact, "1");
  assert.equal(f.calls.filter(call => call.side === "BUY").length, 1);
});
test("planned de backup con consulta todavía ausente no habilita una compra nueva", async () => {
  const f = fixture(); f.loseReply(); await assert.rejects(f.engine().buy("100", METADATA));
  f.intents[0].state = "planned"; f.nullQueries(); f.exchange.listOrders = async () => [];
  await assert.rejects(f.engine().reconcile()); await assert.rejects(f.engine().buy("100", METADATA)); assert.equal(f.calls.length, 1);
});
test("stop parcial ya conciliado no se reemplaza por MARKET ni usa saldo ajeno", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA);
  const stop = [...f.remote.values()].find(order => order.type === "STOP_LOSS")!; f.complete(stop, "0.4", "PARTIALLY_FILLED");
  await f.engine().reconcile(); assert.equal(f.bot.positionQtyExact, "0.6");
  await assert.rejects(f.engine().sell(METADATA)); assert.equal(f.replaceCalls.length, 0, "no intenta cancelar un stop disparado");
  assert.equal(f.calls.filter(call => call.side === "SELL" && call.type === "MARKET").length, 0);
});

test("BUY confirmado seguido de 429 leyendo fills conserva intención recuperable", async () => {
  const f = fixture();
  const listTrades = f.exchange.listTrades;
  let reads = 0;
  f.exchange.listTrades = async (pair, orderId) => {
    if (reads++ === 0) throw new BinanceOrderError(-1003, 429, "Esperar rate limit", 20_000);
    return listTrades(pair, orderId);
  };
  await assert.rejects(f.engine().buy("100", METADATA), BinanceOrderError);
  assert.equal(f.remote.size, 1, "la compra ya fue aceptada por el exchange");
  assert.equal(f.intents[0].state, "unknown", "un rechazo de GET no puede rechazar retroactivamente el BUY");
  await f.engine().reconcile(); await f.engine().protect();
  assert.equal(f.intents[0].state, "filled"); assert.equal(f.bot.positionQtyExact, "1");
  assert.equal(f.calls.filter(call => call.side === "BUY").length, 1);
});

test("venta cancelReplace confirmada seguida de 429 en fills no queda rechazada", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA);
  const listTrades = f.exchange.listTrades;
  let reads = 0;
  f.exchange.listTrades = async (pair, orderId) => {
    if (reads++ === 0) throw new BinanceOrderError(-1003, 429, "Esperar rate limit", 20_000);
    return listTrades(pair, orderId);
  };
  await assert.rejects(f.engine().sell(METADATA), BinanceOrderError);
  assert.equal(f.intents.at(-1)?.state, "unknown");
  assert.equal(f.calls.filter(call => call.side === "SELL" && call.type === "MARKET").length, 1);
  await f.engine().reconcile(); await f.engine().sell(METADATA);
  assert.equal(f.bot.positionQtyExact, "0");
  assert.equal(f.calls.filter(call => call.side === "SELL" && call.type === "MARKET").length, 1);
});

test("saldo se relee después de importar BUY que completa mientras se concilia", async () => {
  const f = fixture(); f.loseReply(); await assert.rejects(f.engine().buy("100", METADATA));
  const pending = [...f.remote.values()][0]; f.complete(pending, "0.4", "PARTIALLY_FILLED");
  f.balances[0].free = "0.4";
  const getOrder = f.exchange.getOrder;
  f.exchange.getOrder = async (pair, ref) => {
    // Después del GET account inicial llegó el resto del fill al exchange.
    f.complete(pending); f.balances[0].free = "1";
    return getOrder(pair, ref);
  };
  await f.engine().reconcile();
  assert.equal(f.bot.positionQtyExact, "1"); assert.equal(f.bot.recoveryState, "ready");
  assert.equal(f.calls.filter(call => call.side === "BUY").length, 1);
});

test("stop ya cruzado sin orden residente ejecuta salida MARKET conservando causa stop", async () => {
  const f = fixture(); f.bot.positionQtyExact = "1"; f.bot.positionCostExact = "100";
  f.bot.investedUsdtExact = "100"; f.bot.stopPrice = 105;
  await f.engine().protect();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].side, "SELL");
  assert.equal(f.calls[0].type, "MARKET"); assert.equal(f.calls[0].quantity, "1");
  assert.equal(f.intents[0].metadata.exitReason, "stop");
  assert.equal(f.bot.positionQtyExact, "0");
});

test("trailing deseado ya cruzado con stop anterior inferior vende mediante cancelReplace", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA);
  assert.equal(f.bot.confirmedStopPrice, "92"); f.bot.stopPrice = 105;
  await f.engine().protect();
  assert.equal(f.replaceCalls.length, 1); assert.equal(f.replaceCalls[0].newOrder.type, "MARKET");
  assert.equal(f.replaceCalls[0].newOrder.quantity, "1");
  assert.equal(f.intents.at(-1)?.metadata.exitReason, "stop"); assert.equal(f.bot.positionQtyExact, "0");
  assert.equal(f.bot.cooldownUntil?.getTime(), 2000 + METADATA.intervalMs);
});

test("stop confirmado ya cruzado espera ejecución remota sin emitir venta extra", async () => {
  const f = fixture(); await f.engine().buy("100", METADATA);
  f.bot.stopPrice = 105; f.exchange.getLastPrice = async () => "90";
  await f.engine().protect();
  assert.equal(f.replaceCalls.length, 0); assert.equal(f.calls.length, 2);
  assert.equal(f.bot.positionQtyExact, "1"); assert.equal(f.bot.confirmedStopPrice, "92");
});
