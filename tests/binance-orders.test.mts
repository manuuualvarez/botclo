import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { add, compare, divide, floorToStep, multiply, normalize, subtract } from "../src/lib/binance/decimal";
import { BinanceOrderClient, BinanceOrderError, UnknownExecutionError } from "../src/lib/binance/orders";

const NOW = 1_790_246_400_000;
const rules = {
  symbols: [{ symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT", quoteAssetPrecision: 8,
    orderTypes: ["MARKET", "STOP_LOSS"], cancelReplaceAllowed: true,
    filters: [
      { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01" },
      { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "9000", stepSize: "0.00001" },
      { filterType: "MARKET_LOT_SIZE", minQty: "0", maxQty: "100", stepSize: "0" },
      { filterType: "NOTIONAL", minNotional: "5", maxNotional: "10000000", applyMinToMarket: true, applyMaxToMarket: true, avgPriceMins: 5 },
    ] }],
};
const remoteOrder = {
  symbol: "BTCUSDT", orderId: "9007199254740993123", clientOrderId: "botclo-test-1",
  side: "SELL", type: "STOP_LOSS", status: "NEW", origQty: "0.001", executedQty: "0",
  cummulativeQuoteQty: "0", stopPrice: "50000", updateTime: NOW,
};
const stop = { symbol: "BTCUSDT", side: "SELL" as const, type: "STOP_LOSS" as const,
  clientOrderId: "botclo-test-1", quantity: "0.001", stopPrice: "50000" };
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
type Request = { url: URL; init?: RequestInit; params: URLSearchParams };
function fixture(handler: (request: Request) => Response | Promise<Response>, environment: "testnet" | "mainnet" = "testnet") {
  const calls: Request[] = [];
  const client = new BinanceOrderClient({ apiKey: "fixture-api-key", apiSecret: "fixture-secret", environment, now: () => NOW,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const params = init?.method === "POST" ? new URLSearchParams(String(init.body)) : url.searchParams;
      const request = { url, init, params };
      calls.push(request);
      if (url.pathname === "/api/v3/exchangeInfo") return json(rules);
      return handler(request);
    },
  });
  return { client, calls };
}

test("decimal: cantidades exactas, exponentes, límites y redondeo hacia abajo", () => {
  assert.equal(add("0.1", "0.2"), "0.3");
  assert.equal(subtract("9007199254740993.00000001", "9007199254740993"), "0.00000001");
  assert.equal(multiply("0.00000001", "9007199254740993"), "90071992.54740993");
  assert.equal(normalize("1.230000e-7"), "0.000000123");
  assert.equal(normalize("-0.000"), "0");
  assert.equal(floorToStep("0.10000000999999", "0.00001"), "0.1");
  assert.equal(floorToStep("-1.01", "0.1"), "-1.1");
  assert.equal(divide("1", "3", 8), "0.33333333");
  assert.equal(compare("1.0000000000000000001", "1"), 1);
  assert.throws(() => normalize("Infinity"));
  assert.throws(() => normalize("1e999999"));
  assert.throws(() => floorToStep("1", "0"));
});

test("POST firmado conserva cantidad/ID y pide RESULT para stops", async () => {
  const { client, calls } = fixture(({ url, init, params }) => {
    assert.equal(url.origin, "https://testnet.binance.vision");
    assert.equal(url.search, "");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("X-MBX-APIKEY"), "fixture-api-key");
    const signature = params.get("signature");
    const unsigned = new URLSearchParams(params); unsigned.delete("signature");
    assert.equal(signature, createHmac("sha256", "fixture-secret").update(unsigned.toString()).digest("hex"));
    assert.equal(params.get("newClientOrderId"), stop.clientOrderId);
    assert.equal(params.get("newOrderRespType"), "RESULT");
    assert.equal(params.get("stopPrice"), "50000");
    assert.equal(params.get("timestamp"), String(NOW));
    return json(remoteOrder);
  });
  assert.equal((await client.placeOrder(stop)).orderId, remoteOrder.orderId);
  assert.equal(calls.filter(c => c.init?.method === "POST").length, 1);
  assert.equal(new Headers(calls[0].init?.headers).has("X-MBX-APIKEY"), false);
});

test("un ID JSON int64 se conserva sin pérdida y números en strings no se reescriben", async () => {
  const { client } = fixture(() => new Response('{"uid":9007199254740993123,"balances":[{"asset":"X123","free":"0.00000001","locked":"1"}]}'));
  assert.deepEqual(await client.getAccount(), { uid: "9007199254740993123", balances: [{ asset: "X123", free: "0.00000001", locked: "1" }] });
});

test("consulta por client ID: -2013 es ausencia temporal, no prueba de rechazo", async () => {
  const { client, calls } = fixture(() => json({ code: -2013, msg: "Order does not exist" }, 400));
  assert.equal(await client.getOrder("BTCUSDT", { clientOrderId: "botclo-unknown" }), null);
  assert.equal(calls[0].params.get("origClientOrderId"), "botclo-unknown");
});

test("cancelada renombrada se consulta por orderId estable sin exigir client ID anterior", async () => {
  const { client, calls } = fixture(({ params }) => params.has("origClientOrderId")
    ? json({ code: -2013 }, 400)
    : json({ ...remoteOrder, status: "CANCELED", clientOrderId: "binance-generated-cancel-id" }));
  assert.equal(await client.getOrder("BTCUSDT", { clientOrderId: remoteOrder.clientOrderId }), null);
  const canceled = await client.getOrder("BTCUSDT", { orderId: remoteOrder.orderId });
  assert.equal(canceled?.orderId, remoteOrder.orderId); assert.equal(canceled?.status, "CANCELED");
  assert.equal(canceled?.clientOrderId, "binance-generated-cancel-id");
  assert.equal(calls[1].params.get("orderId"), remoteOrder.orderId);
  assert.equal(calls[1].params.has("origClientOrderId"), false);
});

for (const scenario of ["network", "body", "500", "504", "-1007", "-1006"] as const) {
  test(`respuesta ${scenario}: resultado desconocido sin retry automático`, async () => {
    let economicOrders = 0;
    const { client } = fixture(() => {
      economicOrders++;
      if (scenario === "network") throw new Error("socket https://fixture-api-key fixture-secret");
      if (scenario === "body") return new Response("{truncated", { status: 200 });
      return json({ code: Number(scenario), msg: "fixture-secret" }, scenario.startsWith("-") ? 400 : Number(scenario));
    });
    await assert.rejects(client.placeOrder(stop), (e: unknown) => {
      assert.ok(e instanceof UnknownExecutionError);
      assert.doesNotMatch(String(e), /fixture-secret|fixture-api-key/);
      return true;
    });
    assert.equal(economicOrders, 1);
  });
}

test("rechazo cierto conserva código pero no secretos reflejados", async () => {
  const { client } = fixture(() => json({ code: -2010, msg: "fixture-api-key fixture-secret" }, 400));
  await assert.rejects(client.placeOrder(stop), (e: unknown) => {
    assert.ok(e instanceof BinanceOrderError);
    assert.equal(e.code, -2010);
    assert.doesNotMatch(String(e), /fixture-secret|fixture-api-key/);
    return true;
  });
});

test("429 respeta Retry-After y no vuelve a enviar antes del vencimiento", async () => {
  const { client, calls } = fixture(() => json({ code: -1003 }, 429, { "Retry-After": "20" }));
  await assert.rejects(client.getAccount(), (e: unknown) => e instanceof BinanceOrderError && e.retryAfterMs === 20000);
  const count = calls.length;
  await assert.rejects(client.getAccount(), BinanceOrderError);
  assert.equal(calls.length, count);
});

test("mainnet cerrado antes de cualquier request mutante", async () => {
  const saved = process.env.ALLOW_REAL_TRADING;
  delete process.env.ALLOW_REAL_TRADING;
  try {
    const { client, calls } = fixture(() => { throw new Error("No debe acceder red"); }, "mainnet");
    await assert.rejects(client.placeOrder(stop), /deshabilitado/);
    await assert.rejects(client.cancelReplace({ symbol: "BTCUSDT", orderId: "9", newOrder: stop }), /deshabilitado/);
    assert.equal(calls.length, 0);
  } finally {
    if (saved === undefined) delete process.env.ALLOW_REAL_TRADING;
    else process.env.ALLOW_REAL_TRADING = saved;
  }
});

test("filtros: step/tick/notional/capacidad rechazan antes del POST", async () => {
  for (const invalid of [{ quantity: "0.001001" }, { stopPrice: "50000.001" }, { quantity: "0.00001" }]) {
    const { client, calls } = fixture(() => { throw new Error("No debe crear orden inválida"); });
    await assert.rejects(client.placeOrder({ ...stop, ...invalid }), BinanceOrderError);
    assert.equal(calls.filter(c => c.init?.method === "POST").length, 0);
  }
});

test("filtros salen del entorno de destino y MARKET usa límites dinámicos", async () => {
  const { client } = fixture(({ url }) => {
    assert.equal(url.origin, "https://testnet.binance.vision");
    if (url.pathname === "/api/v3/avgPrice") return json({ mins: 5, price: "50000" });
    throw new Error("No enviar un notional insuficiente");
  });
  await assert.rejects(client.placeOrder({ ...stop, type: "MARKET", stopPrice: undefined, quantity: "0.00001" }), BinanceOrderError);
});

test("cancelReplace conserva cancelación exitosa y reemplazo rechazado de HTTP 409", async () => {
  const { client } = fixture(({ params }) => {
    assert.equal(params.get("cancelReplaceMode"), "STOP_ON_FAILURE");
    assert.equal(params.get("cancelRestrictions"), "ONLY_NEW");
    assert.equal(params.get("orderRateLimitExceededMode"), "DO_NOTHING");
    assert.equal(params.get("cancelOrderId"), "9007199254740993123");
    return json({ code: -2021, data: { cancelResult: "SUCCESS", newOrderResult: "FAILURE",
      cancelResponse: { ...remoteOrder, status: "CANCELED" }, newOrderResponse: { code: -2010, msg: "rejected" } } }, 409);
  });
  const outcome = await client.cancelReplace({ symbol: "BTCUSDT", orderId: remoteOrder.orderId, newOrder: stop });
  assert.equal(outcome.cancelResult, "SUCCESS");
  assert.equal(outcome.canceledOrder?.status, "CANCELED");
  assert.equal(outcome.newOrderResult, "FAILURE");
  assert.equal(outcome.newOrderError?.code, -2010);
  assert.equal(outcome.newOrder, undefined);
});

test("cancelReplace stop ya ejecutado: falla cancelación y no se intenta venta", async () => {
  const { client } = fixture(() => json({ code: -2022, data: { cancelResult: "FAILURE", newOrderResult: "NOT_ATTEMPTED",
    cancelResponse: { code: -2011, msg: "Unknown order" }, newOrderResponse: null } }, 400));
  const outcome = await client.cancelReplace({ symbol: "BTCUSDT", orderId: remoteOrder.orderId, newOrder: stop });
  assert.equal(outcome.cancelResult, "FAILURE");
  assert.equal(outcome.newOrderResult, "NOT_ATTEMPTED");
  assert.equal(outcome.cancelError?.code, -2011);
});

test("fills paginados por orderId+fromId sin perder IDs ni comisiones", async () => {
  const base = BigInt("9007199254740993000");
  const makeFill = (i: number) => ({ symbol: "BTCUSDT", id: String(base + BigInt(i)), orderId: remoteOrder.orderId,
    price: "50000", qty: "0.00001", quoteQty: "0.5", commission: "0.00000001", commissionAsset: "BTC", time: NOW });
  const { client, calls } = fixture(({ params }) => {
    assert.equal(params.get("orderId"), remoteOrder.orderId);
    const from = params.get("fromId");
    if (from === "0") return json(Array.from({ length: 1000 }, (_, i) => makeFill(i)));
    assert.equal(from, String(base + BigInt(1000)));
    return json([makeFill(1000)]);
  });
  const fills = await client.listTrades("BTCUSDT", remoteOrder.orderId);
  assert.equal(fills.length, 1001);
  assert.equal(fills.at(-1)?.id, String(base + BigInt(1000)));
  assert.equal(fills[0].commission, "0.00000001");
  assert.equal(calls.length, 2);
});

test("historial de órdenes divide intervalos en ventanas de hasta 24 horas", async () => {
  const { client, calls } = fixture(({ params }) => {
    assert.ok(Number(params.get("endTime")) - Number(params.get("startTime")) < 86400000);
    assert.equal(params.get("orderId"), "0");
    return json([]);
  });
  assert.deepEqual(await client.listOrders("BTCUSDT", NOW, NOW + 2 * 86400000), []);
  assert.equal(calls.length, 3);
});

test("respuesta de símbolo ajeno bloquea atribución", async () => {
  const { client } = fixture(() => json({ ...remoteOrder, symbol: "ETHUSDT" }));
  await assert.rejects(client.getOrder("BTCUSDT", { orderId: remoteOrder.orderId }));
});

test("cancelReplace exitoso devuelve ambas órdenes confirmadas", async () => {
  const { client } = fixture(() => json({ cancelResult: "SUCCESS", newOrderResult: "SUCCESS",
    cancelResponse: { ...remoteOrder, status: "CANCELED" }, newOrderResponse: { ...remoteOrder, orderId: "9007199254740993124" } }));
  const outcome = await client.cancelReplace({ symbol: "BTCUSDT", orderId: remoteOrder.orderId, newOrder: stop });
  assert.equal(outcome.canceledOrder?.orderId, remoteOrder.orderId);
  assert.equal(outcome.newOrder?.orderId, "9007199254740993124");
});

test("historial saturado pagina por IDs exactos y detecta una página repetida", async () => {
  const first = BigInt("9007199254740993000");
  const rows = Array.from({ length: 1000 }, (_, i) => ({ ...remoteOrder, orderId: String(first + BigInt(i)) }));
  const { client, calls } = fixture(({ params }) => params.get("orderId") === "0" ? json(rows) : json([]));
  assert.equal((await client.listOrders("BTCUSDT", NOW, NOW + 10)).length, 1000);
  assert.equal(calls[1].params.get("orderId"), String(first + BigInt(1000)));
  const repeated = fixture(() => json(rows));
  await assert.rejects(repeated.client.listOrders("BTCUSDT", NOW, NOW + 10), /no avanzó/);
});

test("no envía STOP_LOSS si el símbolo solo admite stop limitado", async () => {
  let mutations = 0;
  const client = new BinanceOrderClient({ apiKey: "fixture", apiSecret: "fixture", environment: "testnet",
    fetch: async (_input, init) => {
      if (init?.method === "POST") mutations++;
      return json({ symbols: [{ ...rules.symbols[0], orderTypes: ["MARKET", "STOP_LOSS_LIMIT"] }] });
    } });
  await assert.rejects(client.placeOrder(stop), /no admite/);
  assert.equal(mutations, 0);
});

test("cuenta reporta permisos y JSON conserva strings con escapes y números", async () => {
  const { client } = fixture(() => new Response('{"uid":123,"canTrade":false,"balances":[{"asset":"X\\\"123","free":"0.1","locked":"0"}]}'));
  const account = await client.getAccount();
  assert.equal(account.canTrade, false);
  assert.equal(account.balances[0].asset, 'X"123');
});

test("JSON mal formado nunca se vuelve válido al convertir tokens numéricos", async () => {
  const { client } = fixture(() => new Response('{"uid":0123,"balances":[]}'));
  await assert.rejects(client.getAccount(), UnknownExecutionError);
});

test("cancelReplace identifica orden cancelada por origClientOrderId", async () => {
  const { client } = fixture(() => json({ cancelResult: "SUCCESS", newOrderResult: "SUCCESS",
    cancelResponse: { ...remoteOrder, status: "CANCELED", origClientOrderId: "original-protection", clientOrderId: "generated-cancel-id" },
    newOrderResponse: { ...remoteOrder, orderId: "9007199254740993124" } }));
  const outcome = await client.cancelReplace({ symbol: "BTCUSDT", orderId: remoteOrder.orderId, newOrder: stop });
  assert.equal(outcome.canceledOrder?.clientOrderId, "original-protection");
  assert.equal(outcome.newOrder?.clientOrderId, stop.clientOrderId);
});

test("último precio exacto sale del mismo entorno sin credenciales", async () => {
  const { client, calls } = fixture(({ url, init, params }) => {
    assert.equal(url.origin, "https://testnet.binance.vision");
    assert.equal(url.pathname, "/api/v3/ticker/price");
    assert.equal(params.get("symbol"), "BTCUSDT");
    assert.equal(params.has("signature"), false);
    assert.equal(new Headers(init?.headers).has("X-MBX-APIKEY"), false);
    return json({ symbol: "BTCUSDT", price: "9007199254740993.00000001" });
  });
  assert.equal(await client.getLastPrice("BTCUSDT"), "9007199254740993.00000001");
  assert.equal(calls.length, 1);
});
