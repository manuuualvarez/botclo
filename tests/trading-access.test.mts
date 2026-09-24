import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.BOTCLO_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/botclo_trading_test") {
  throw new Error("Estas pruebas requieren el PostgreSQL efímero del harness.");
}
process.env.DATABASE_URL = url;
process.env.BINANCE_USE_TESTNET = "true";
process.env.ENCRYPTION_KEY = "ab".repeat(32);
const { pg } = await import("../src/db");
const { encrypt } = await import("../src/lib/crypto");
const { connectTradingAccount: saveCredentials, readTradingAccount: getDecryptedCredentials, disconnectTradingAccount: deleteCredentials } = await import("../src/lib/bot/trading-access");
const { TRADING_LOCK_KEY } = await import("../src/lib/bot/trading-lock");
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async (input, init) => {
  const endpoint = new URL(String(input));
  assert.equal(endpoint.origin, "https://testnet.binance.vision");
  assert.equal(endpoint.pathname, "/api/v3/account");
  assert.equal(init?.method, "GET");
  requests++;
  const key = new Headers(init?.headers).get("X-MBX-APIKEY");
  if (key === "revoked-key") return Response.json({ code: -2015, msg: "fixture" }, { status: 401 });
  return Response.json({ uid: key === "other-account" ? "999" : "123", canTrade: true, balances: [] });
};
after(async () => { globalThis.fetch = originalFetch; await pg.end(); });

async function fixture(exposed = false, native = true, key = "old-key") {
  const userId = randomUUID();
  await pg`insert into binance_credentials(user_id,api_key_encrypted,api_secret_encrypted,is_testnet)
    values(${userId},${encrypt(key)},${encrypt("fixture-secret")},true)`;
  const [bot] = await pg`insert into bot_configs(user_id,strategy_id,symbol,budget_usdt,position_qty,position_qty_exact,recovery_state,trading_environment,exchange_account_id)
    values(${userId},'dca','BTCUSDT',100,${exposed ? 1 : 0},${exposed ? "1" : "0"},${native ? "ready" : "legacy"},${native ? "testnet" : null},${native ? "123" : null}) returning id`;
  return { userId, botId: Number(bot.id) };
}
test("lectura rechaza entorno distinto antes de descifrar", async () => {
  const f = await fixture();
  await pg`update binance_credentials set is_testnet=false,api_key_encrypted='invalid' where user_id=${f.userId}`;
  await assert.rejects(getDecryptedCredentials(f.userId), /entorno/);
});
test("desconexión con posición conserva las claves guardadas", async () => {
  const f = await fixture(true);
  await assert.rejects(deleteCredentials(f.userId), /posición|protección|pendiente/);
  assert.equal((await getDecryptedCredentials(f.userId))?.apiKey, "old-key");
});
test("rotación de robot nativo exige mismo UID y permite nueva key de su cuenta", async () => {
  const f = await fixture(true);
  await assert.rejects(saveCredentials(f.userId, "other-account", "secret"), /otra cuenta/);
  assert.equal((await getDecryptedCredentials(f.userId))?.apiKey, "old-key");
  await saveCredentials(f.userId, "next-key", "new-secret");
  assert.deepEqual(await getDecryptedCredentials(f.userId), { apiKey: "next-key", apiSecret: "new-secret" });
});
test("legacy expuesto verifica cuenta anterior; clave revocada no habilita reemplazo ciego", async () => {
  const f = await fixture(true, false, "revoked-key");
  await assert.rejects(saveCredentials(f.userId, "next-key", "secret"));
  assert.equal((await getDecryptedCredentials(f.userId))?.apiKey, "revoked-key");
  const same = await fixture(true, false);
  await assert.rejects(saveCredentials(same.userId, "other-account", "secret"), /otra cuenta/);
  await saveCredentials(same.userId, "next-key", "secret");
  assert.equal((await getDecryptedCredentials(same.userId))?.apiKey, "next-key");
});
test("desconexión sin exposición borra sólo las claves del usuario", async () => {
  const f = await fixture(); const other = await fixture();
  await deleteCredentials(f.userId);
  assert.equal(await getDecryptedCredentials(f.userId), null);
  assert.equal((await getDecryptedCredentials(other.userId))?.apiKey, "old-key");
});
test("rotación y desconexión no compiten con un tick que conserva el lock", async () => {
  const f = await fixture(); const connection = await pg.reserve();
  try {
    await connection`select pg_advisory_lock(${TRADING_LOCK_KEY})`;
    const before = requests;
    await assert.rejects(saveCredentials(f.userId, "next-key", "secret"), /revisión/);
    await assert.rejects(deleteCredentials(f.userId), /revisión/);
    assert.equal(requests, before);
    assert.equal((await getDecryptedCredentials(f.userId))?.apiKey, "old-key");
  } finally { await connection`select pg_advisory_unlock(${TRADING_LOCK_KEY})`; connection.release(); }
});
