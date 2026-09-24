// Solo lectura en PostgreSQL y Binance. Nunca llama placeOrder/cancelReplace.
// node --env-file=.env --import tsx scripts/trading-preflight.mts --output /backup/manifest.json
import { readFile, writeFile } from "node:fs/promises";
import { db, pg } from "../src/db";
import { readTradingAccount } from "../src/lib/bot/trading-access";
import { isTestnet } from "../src/lib/binance/client";
import { BinanceOrderClient } from "../src/lib/binance/orders";
import { compare, floorToStep, subtract } from "../src/lib/binance/decimal";
import { prepareLegacyAdoption } from "../src/lib/bot/trading-adoption";
import { createTradingStore } from "../src/lib/bot/trading-store";

const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output || output.startsWith("--")) throw new Error("Indicá --output con un archivo nuevo fuera del VPS.");
const requireProtected = process.argv.includes("--require-protected");
const expectedPath = process.argv.includes("--expected") ? process.argv[process.argv.indexOf("--expected") + 1] : undefined;
if (requireProtected && !expectedPath) throw new Error("El preflight de corte requiere --expected con el manifiesto externo anterior.");
const results: Record<string, unknown>[] = [];
try {
  const bots = await db.query.botConfigs.findMany();
  if (expectedPath) {
    const expected = JSON.parse(await readFile(expectedPath, "utf8")) as { bots?: { tradingId?: string; symbol?: string; userId?: string }[] };
    if (!Array.isArray(expected.bots) || expected.bots.length === 0) throw new Error("Manifiesto externo vacío o inválido.");
    for (const previous of expected.bots) {
      const current = bots.find(b => b.tradingId === previous.tradingId);
      if (!current || current.symbol !== previous.symbol || current.userId !== previous.userId) {
        throw new Error("La base no contiene todas las identidades del manifiesto externo. No cortar ni reanudar trading.");
      }
    }
  }
  const environment = isTestnet() ? "testnet" : "mainnet";
  const store = createTradingStore(pg);
  for (const bot of bots.filter(b => b.status !== "archived")) {
    const result: Record<string, unknown> = { botId: bot.id, tradingId: bot.tradingId, userId: bot.userId, symbol: bot.symbol,
      strategyId: bot.strategyId, environment, state: bot.recoveryState, desiredStop: bot.stopPrice, ok: false };
    try {
      const credentials = await readTradingAccount(bot.userId);
      if (!credentials) throw new Error("Sin credenciales.");
      if (bot.tradingEnvironment && bot.tradingEnvironment !== environment) throw new Error("Entorno diferente al configurado.");
      const exchange = new BinanceOrderClient({ ...credentials, environment });
      if (bot.recoveryState === "legacy") {
        const trades = await pg<{ binanceOrderId: string | null; side: "BUY" | "SELL"; symbol: string; isTestnet: boolean; qty: number; quoteQty: number }[]>`
          SELECT binance_order_id::text AS "binanceOrderId", side, symbol, is_testnet AS "isTestnet", qty, quote_qty AS "quoteQty"
          FROM bot_trades WHERE bot_id=${bot.id} ORDER BY executed_at,id
        `;
        result.adoption = await prepareLegacyAdoption({ bot, trades: [...trades], exchange, environment });
        if (requireProtected) throw new Error("Robot legado: todavía no fue adoptado por el ejecutor protegido.");
      } else {
        const account = await exchange.getAccount();
        if (account.uid !== bot.exchangeAccountId) throw new Error("Cuenta diferente a la vinculada al robot.");
        result.accountId = account.uid;
        result.positionQty = bot.positionQtyExact;
        const intents = await store.listIntents(bot.id);
        result.intents = intents.map(i => ({ id: i.id, clientOrderId: i.clientOrderId, orderId: i.exchangeOrderId, state: i.state }));
        if (bot.recoveryState !== "ready" || intents.some(i => ["planned","submitting","unknown","review"].includes(i.state) || (i.state === "open" && i.request.type === "MARKET"))) {
          throw new Error("Conciliación pendiente: no cortar el VPS.");
        }
        if (compare(bot.positionQtyExact, "0") > 0 && bot.stopPrice !== null) {
          const protection = intents.find(i => i.id === bot.protectionIntentId);
          if (!protection) throw new Error("Posición con stop requerido pero sin protección registrada.");
          const order = await exchange.getOrder(bot.symbol, { clientOrderId: protection.clientOrderId });
          const rules = await exchange.getRules(bot.symbol);
          if (!order || !["NEW", "PARTIALLY_FILLED"].includes(order.status) || order.side !== "SELL" || order.type !== "STOP_LOSS" ||
              compare(subtract(order.origQty, order.executedQty), floorToStep(bot.positionQtyExact, rules.stepSize)) !== 0 ||
              !order.stopPrice || !bot.confirmedStopPrice || compare(order.stopPrice, bot.confirmedStopPrice) !== 0) {
            throw new Error("La protección remota no cubre la posición registrada. Conciliá y repetí el preflight.");
          }
          result.protection = { orderId: order.orderId, clientOrderId: order.clientOrderId, quantity: order.origQty, stopPrice: order.stopPrice };
        } else if (compare(bot.positionQtyExact, "0") > 0) {
          result.unprotectedByStrategy = true;
          if (requireProtected) throw new Error("Esta estrategia mantiene exposición sin stop; requiere tratamiento explícito antes del corte.");
        }
      }
      result.ok = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Preflight fallido.";
    }
    results.push(result);
  }
  await writeFile(output, JSON.stringify({ createdAt: new Date().toISOString(), release: process.env.BOT_RELEASE ?? "unspecified", requireProtected, bots: results }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  const failures = results.filter(r => !r.ok).length;
  console.log(`Preflight: ${results.length} robots; ${failures} requieren revisión. Manifiesto guardado con permisos 0600.`);
  if (failures) process.exitCode = 1;
} finally { await pg.end(); }
