import assert from "node:assert/strict";
import { open, readFile, realpath, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { add, divide, subtract } from "../src/lib/binance/decimal";
import type { ExchangeFill, ExchangeOrder, ExchangeRules, NewExchangeOrder } from "../src/lib/binance/orders";
import { createTradingEngine } from "../src/lib/bot/trading-engine";
import { createTradingStore } from "../src/lib/bot/trading-store";
import { encrypt } from "../src/lib/crypto";

const url = process.env.BOTCLO_RECOVERY_DATABASE_URL;
const remoteFile = process.env.BOTCLO_RECOVERY_REMOTE_FILE;
const mode = process.argv[2];
if (!url || !remoteFile || !["crash", "recover", "native-crash", "native-recover"].includes(mode)) throw new Error("Ejecutá scripts/test-trading-recovery.mjs.");
const destination = new URL(url);
if (destination.hostname !== "127.0.0.1" || destination.username !== "botclo_test" ||
    !["/botclo_recovery_test", "/botclo_recovery_restore_test", "/botclo_recovery_native_test"].includes(destination.pathname) ||
    process.env.DATABASE_URL !== url || process.env.BINANCE_USE_TESTNET !== "true" || process.env.ALLOW_REAL_TRADING !== "false") {
  throw new Error("El child solo admite las bases efímeras loopback del harness.");
}
const directory = await realpath(dirname(remoteFile));
if (basename(remoteFile) !== "remote.json" || dirname(directory) !== await realpath(tmpdir()) || !basename(directory).startsWith("botclo-recovery-test-")) {
  throw new Error("El exchange fake debe vivir en el directorio temporal exclusivo del harness.");
}
// Cualquier conexión HTTP accidental hace fallar la prueba antes de tocar red.
globalThis.fetch = async () => { throw new Error("La prueba de recuperación no permite HTTP."); };

interface RemoteFixture { orders: ExchangeOrder[]; fills: ExchangeFill[]; requests: NewExchangeOrder[]; candleOpenTime?: number }
async function readRemote(): Promise<RemoteFixture> { return JSON.parse(await readFile(remoteFile!, "utf8")) as RemoteFixture; }
async function saveRemote(remote: RemoteFixture) {
  const temporary = join(directory, "remote.json.next");
  const file = await open(temporary, "w", 0o600);
  try { await file.writeFile(JSON.stringify(remote)); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, remoteFile!);
}

const rules: ExchangeRules = { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
  quoteAssetPrecision: 8, orderTypes: ["MARKET", "STOP_LOSS"], cancelReplaceAllowed: true,
  minQty: "0.001", maxQty: "100", stepSize: "0.001", minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01",
  minNotional: "5", maxNotional: "0", applyMinToMarket: true, applyMaxToMarket: false, avgPriceMins: 5 };
const sql = postgres(url, { max: 3, onnotice: () => {} });
const db = drizzle(sql, { schema });
const store = createTradingStore(sql);
type Exchange = Parameters<typeof createTradingEngine>[0]["exchange"];
let nativeConnection: postgres.Sql | undefined;

const exchange: Exchange = {
  getRules: async (symbol) => { assert.equal(symbol, rules.symbol); return rules; },
  getLastPrice: async (symbol) => { assert.equal(symbol, rules.symbol); return "100"; },
  getAccount: async () => {
    const remote = await readRemote();
    const qty = remote.fills.reduce((total, fill) => add(total, subtract(fill.qty, fill.commission)), "0");
    const locked = remote.orders.filter(order => order.type === "STOP_LOSS" && order.status === "NEW")
      .reduce((total, order) => add(total, order.origQty), "0");
    return { uid: "9007199254740993000", canTrade: true, balances: [{ asset: "BTC", free: subtract(qty, locked), locked }] };
  },
  getOrder: async (symbol, lookup) => {
    assert.equal(symbol, rules.symbol);
    return (await readRemote()).orders.find(order => order.clientOrderId === lookup.clientOrderId || order.orderId === lookup.orderId) ?? null;
  },
  listOrders: async (symbol, from, until) => {
    assert.equal(symbol, rules.symbol);
    return (await readRemote()).orders.filter(order => order.updateTime >= from && order.updateTime <= until);
  },
  listTrades: async (symbol, orderId) => {
    assert.equal(symbol, rules.symbol);
    return (await readRemote()).fills.filter(fill => fill.orderId === orderId);
  },
  placeOrder: async (request) => {
    const [intent] = await sql`select state from bot_order_intents where client_order_id=${request.clientOrderId}`;
    assert.equal(intent?.state, "submitting", "persistir intención antes de aceptar en exchange fake");
    const remote = await readRemote();
    assert.equal(remote.orders.some(order => order.clientOrderId === request.clientOrderId), false);
    assert.ok(request.side === "BUY" || (request.side === "SELL" && request.type === "STOP_LOSS"), "este escenario no solicita ventas de mercado");
    const time = Date.now();
    const order: ExchangeOrder = { symbol: request.symbol, clientOrderId: request.clientOrderId,
      orderId: String(BigInt("9007199254740993100") + BigInt(remote.orders.length + 1)), side: request.side,
      type: request.type, status: request.type === "MARKET" ? "FILLED" : "NEW",
      origQty: request.quantity ?? divide(request.quoteOrderQty!, "100"),
      executedQty: request.type === "MARKET" ? divide(request.quoteOrderQty!, "100") : "0",
      cummulativeQuoteQty: request.type === "MARKET" ? request.quoteOrderQty! : "0",
      stopPrice: request.stopPrice, updateTime: time };
    remote.requests.push(request); remote.orders.push(order);
    if (request.side === "BUY") {
      remote.fills.push({ symbol: request.symbol, orderId: order.orderId, id: "9007199254740994001", qty: order.executedQty,
        price: "100", quoteQty: order.cummulativeQuoteQty, commission: "0.001", commissionAsset: "BTC", time });
    }
    await saveRemote(remote);
    if (mode === "crash" && request.side === "BUY") {
      // Muerte efectiva: no corre catch/finally del engine, no hay apply ni
      // cierre prolijo del socket PostgreSQL. El parent exige este exit code.
      process.exit(77);
    }
    return order;
  },
  cancelReplace: async () => { throw new Error("El replay de este escenario no debe reemplazar el stop confirmado."); },
};

function installNativeFetchFixture() {
  let candlesServed = false;
  let ruleRequests = 0;
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  // No se conserva ni invoca fetch original. Incluso los hosts permitidos
  // resuelven íntegramente en memoria/JSON temporal, sin socket HTTP.
  globalThis.fetch = async (input, init) => {
    const address = new URL(input instanceof Request ? input.url : String(input));
    if (address.protocol !== "https:" || address.port || !["testnet.binance.vision", "data-api.binance.vision"].includes(address.hostname)) {
      throw new Error("Host inesperado: el tick de prueba no permite HTTP real.");
    }
    const method = init?.method ?? "GET";
    const params = method === "POST" ? new URLSearchParams(String(init?.body)) : address.searchParams;
    if (address.hostname === "data-api.binance.vision") {
      assert.equal(method, "GET"); assert.equal(address.pathname, "/api/v3/klines");
      assert.equal(params.get("symbol"), "BTCUSDT"); assert.equal(params.get("interval"), "1d");
      const remote = await readRemote(); assert.ok(remote.candleOpenTime);
      const day = 86_400_000;
      candlesServed = true;
      return json([-2, -1, 0, 1].map(offset => {
        const start = remote.candleOpenTime! + offset * day;
        return [start, "100", "101", "99", "100", "10", start + day - 1];
      }));
    }
    if (address.pathname === "/api/v3/exchangeInfo") {
      assert.equal(method, "GET"); assert.equal(params.get("symbol"), "BTCUSDT");
      ruleRequests++;
      if (mode === "native-crash" && candlesServed) {
        assert.equal(ruleRequests, 2, "la caída debe ocurrir después de conciliar y descargar velas, antes de BUY");
        process.exit(77);
      }
      return json({ symbols: [{ ...rules, filters: [
        { filterType: "PRICE_FILTER", minPrice: rules.minPrice, maxPrice: rules.maxPrice, tickSize: rules.tickSize },
        { filterType: "LOT_SIZE", minQty: rules.minQty, maxQty: rules.maxQty, stepSize: rules.stepSize },
        { filterType: "MIN_NOTIONAL", minNotional: rules.minNotional, applyToMarket: true, avgPriceMins: 5 },
      ] }] });
    }
    // Las credenciales son texto fixture cifrado en la DB efímera. El
    // cliente real debe descifrarlas y firmar antes de llegar al stub.
    assert.equal(new Headers(init?.headers).get("X-MBX-APIKEY"), "fixture-native-key");
    assert.ok(params.get("signature"));
    if (address.pathname === "/api/v3/account" && method === "GET") return json(await exchange.getAccount());
    if (address.pathname === "/api/v3/allOrders" && method === "GET") {
      return json(await exchange.listOrders(params.get("symbol")!, Number(params.get("startTime")), Number(params.get("endTime"))));
    }
    if (address.pathname === "/api/v3/myTrades" && method === "GET") {
      return json(await exchange.listTrades(params.get("symbol")!, params.get("orderId")!));
    }
    if (address.pathname === "/api/v3/order" && method === "GET") {
      const order = await exchange.getOrder(params.get("symbol")!, { clientOrderId: params.get("origClientOrderId") ?? undefined,
        orderId: params.get("orderId") ?? undefined });
      assert.ok(order); return json(order);
    }
    if (address.pathname === "/api/v3/order" && method === "POST") {
      assert.equal(params.get("side"), "BUY"); assert.equal(params.get("type"), "MARKET");
      return json(await exchange.placeOrder({ symbol: params.get("symbol")!, clientOrderId: params.get("newClientOrderId")!,
        side: "BUY", type: "MARKET", quoteOrderQty: params.get("quoteOrderQty")! }));
    }
    throw new Error(`Endpoint inesperado en el tick offline: ${method} ${address.pathname}`);
  };
}

const lock = await sql.reserve();
try {
  const [{ locked }] = await lock`select pg_try_advisory_lock(918273645) locked`;
  assert.equal(locked, true, "PostgreSQL libera el lock de la sesión que murió");
  const loadBot = async () => {
    const bot = await db.query.botConfigs.findFirst({ where: eq(schema.botConfigs.userId,
      mode.startsWith("native-") ? "native-recovery-fixture" : "recovery-fixture") });
    assert.ok(bot); return bot;
  };
  const bot = await loadBot();
  if (mode.startsWith("native-")) {
    await db.insert(schema.binanceCredentials).values({ userId: bot.userId,
      apiKeyEncrypted: encrypt("fixture-native-key"), apiSecretEncrypted: encrypt("fixture-native-secret"), isTestnet: true })
      .onConflictDoNothing();
    installNativeFetchFixture();
    const { runNativeBotTick } = await import("../src/lib/bot/native-executor");
    nativeConnection = (await import("../src/db")).pg;
    const result = await runNativeBotTick(bot);
    if (mode === "native-crash") throw new Error("El tick tenía que morir antes de persistir la intención BUY.");
    assert.equal(result.action, bot.lastCandleTime === null ? "buy" : "hold");
    const after = await loadBot();
    assert.equal(after.positionQtyExact, "0.999");
    assert.equal(after.confirmedStopPrice, null, "DCA no agrega un stop que su estrategia no solicitó");
    assert.equal(after.lastCandleTime, (await readRemote()).candleOpenTime);
  } else {
    const engine = createTradingEngine({ exchange, store, loadBot, intervalMs: 3_600_000,
      saveBot: async patch => { await db.update(schema.botConfigs).set(patch).where(eq(schema.botConfigs.id, bot.id)); } });
    if (mode === "crash") {
      await engine.buy("100", { reason: "Fixture de crash real", intervalMs: 3_600_000, protection: { atr: null, stopMultiple: 2 } });
      throw new Error("La prueba tenía que morir tras la aceptación remota.");
    }
    await engine.reconcile();
    await engine.protect();
    const result = await loadBot();
    assert.equal(result.positionQtyExact, "0.999");
    assert.equal(result.investedUsdtExact, "100");
    assert.equal(result.confirmedStopPrice, "92");
  }
} finally {
  await lock`select pg_advisory_unlock(918273645)`;
  lock.release();
  await sql.end();
  await nativeConnection?.end();
}
