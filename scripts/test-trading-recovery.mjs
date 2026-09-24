// Crash real + restore de PostgreSQL. Toda conexión usa una base efímera
// exclusiva en loopback; nunca se lee DATABASE_URL ni se usa Binance real.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const name = `botclo-recovery-test-${randomUUID()}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let sql;
let restored;
let native;
let temporary;

function runChild(url, remoteFile, mode) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "tests/trading-recovery-child.mts", mode], {
    stdio: "inherit", timeout: 30_000,
    // No heredar variables del shell que puedan habilitar trading o cargar
    // secretos/productivo. La conexión también se valida adentro del child.
    env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), DATABASE_URL: url, BOTCLO_RECOVERY_DATABASE_URL: url,
      BOTCLO_RECOVERY_REMOTE_FILE: remoteFile, BINANCE_USE_TESTNET: "true", ALLOW_REAL_TRADING: "false",
      BOT_NATIVE_PROTECTION_ENABLED: "false", ENCRYPTION_KEY: "0".repeat(64), NODE_ENV: "test" },
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, "el child no debe terminar por timeout/señal externa");
  assert.equal(result.status, mode.endsWith("crash") ? 77 : 0, `salida inesperada en ${mode}`);
}

async function assertRecovered(connection, remoteFile) {
  const [bot] = await connection`select * from bot_configs where user_id='recovery-fixture'`;
  assert.equal(bot.position_qty_exact, "0.999");
  assert.equal(bot.position_cost_exact, "100");
  assert.equal(bot.invested_usdt_exact, "100");
  assert.equal(bot.position_qty, 0.999);
  assert.equal(bot.invested_usdt, 100);
  assert.equal(bot.recovery_state, "ready");
  assert.equal(bot.confirmed_stop_price, "92");
  const intents = await connection`select action,state,exchange_order_id from bot_order_intents order by created_at,id`;
  assert.deepEqual(intents.map(({ action, state }) => ({ action, state })), [
    { action: "buy", state: "filled" }, { action: "protect", state: "open" },
  ]);
  const [counts] = await connection`select (select count(*)::int from bot_order_fills) fills,
    (select count(*)::int from bot_trades) trades`;
  assert.deepEqual({ ...counts }, { fills: 1, trades: 1 });
  const remote = JSON.parse(await readFile(remoteFile, "utf8"));
  assert.equal(remote.requests.filter(request => request.side === "BUY").length, 1);
  assert.equal(remote.requests.filter(request => request.type === "STOP_LOSS").length, 1);
  assert.equal(remote.orders.length, 2);
  assert.equal(remote.fills.length, 1);
}

try {
  temporary = await mkdtemp(join(tmpdir(), "botclo-recovery-test-"));
  const remoteFile = join(temporary, "remote.json");
  await writeFile(remoteFile, JSON.stringify({ orders: [], fills: [], requests: [] }), { mode: 0o600 });
  docker("run", "--detach", "--name", name, "--label", "botclo.purpose=recovery-tests", "--publish", "127.0.0.1::5432",
    "--tmpfs", "/var/lib/postgresql/data", "--env", "POSTGRES_USER=botclo_test", "--env", "POSTGRES_PASSWORD=isolated_test_only",
    "--env", "POSTGRES_DB=botclo_recovery_test", "postgres:17-alpine");
  const address = docker("port", name, "5432/tcp");
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error("El puerto de recuperación debe ser loopback.");
  const url = `postgresql://botclo_test:isolated_test_only@${address}/botclo_recovery_test`;
  sql = postgres(url, { max: 2, onnotice: () => {} });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await sql`select 1`; ready = true; break; } catch { await setTimeout(100); }
  }
  if (!ready) throw new Error("PostgreSQL exclusivo no quedó disponible.");
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql`insert into bot_configs (user_id,strategy_id,symbol,budget_usdt,status,recovery_state,trading_environment,exchange_account_id)
    values ('recovery-fixture','sma-cross','BTCUSDT',100,'active','ready','testnet','9007199254740993000')`;

  runChild(url, remoteFile, "crash");
  const [pending] = await sql`select state from bot_order_intents`;
  assert.equal(pending.state, "submitting", "la muerte ocurre luego del commit previo al envío");
  const [untouched] = await sql`select position_qty_exact,invested_usdt_exact from bot_configs`;
  assert.deepEqual({ ...untouched }, { position_qty_exact: "0", invested_usdt_exact: "0" });
  const [beforeReplay] = await sql`select count(*)::int count from bot_order_fills`;
  assert.equal(beforeReplay.count, 0);
  const accepted = JSON.parse(await readFile(remoteFile, "utf8"));
  assert.equal(accepted.orders[0].status, "FILLED", "la aceptación remota sobrevive al child muerto");
  assert.equal(accepted.requests.length, 1);
  console.log("✔ Crash real: BUY aceptado fuera del proceso; journal submitting y contabilidad todavía sin aplicar");

  for (let restart = 0; restart < 2; restart++) {
    runChild(url, remoteFile, "recover");
    await assertRecovered(sql, remoteFile);
  }
  console.log("✔ Dos reinicios: una compra, un fill aplicado y un stop residente, sin duplicación");

  const dump = execFileSync("docker", ["exec", name, "pg_dump", "--username=botclo_test", "--dbname=botclo_recovery_test", "--format=custom"],
    { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  await sql`create database botclo_recovery_restore_test`;
  execFileSync("docker", ["exec", "--interactive", name, "pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
    "--username=botclo_test", "--dbname=botclo_recovery_restore_test"], { input: dump, stdio: ["pipe", "pipe", "pipe"] });
  const restoreUrl = url.replace("/botclo_recovery_test", "/botclo_recovery_restore_test");
  restored = postgres(restoreUrl, { max: 1, onnotice: () => {} });
  runChild(restoreUrl, remoteFile, "recover");
  await assertRecovered(restored, remoteFile);
  console.log("✔ pg_dump → DB nueva → pg_restore → reconciliación: identidad, contabilidad y stop conservados sin recomprar");

  await sql`create database botclo_recovery_native_test`;
  const nativeUrl = url.replace("/botclo_recovery_test", "/botclo_recovery_native_test");
  native = postgres(nativeUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(native), { migrationsFolder: "./drizzle" });
  await native`insert into bot_configs (user_id,strategy_id,symbol,budget_usdt,params,status,recovery_state,trading_environment,exchange_account_id)
    values ('native-recovery-fixture','dca','BTCUSDT',100,'{"montoPorCompra":100,"cadaNVelas":1}',
      'active','ready','testnet','9007199254740993000')`;
  const candleOpenTime = Math.floor(Date.now() / 86_400_000) * 86_400_000 - 86_400_000;
  await writeFile(remoteFile, JSON.stringify({ orders: [], fills: [], requests: [], candleOpenTime }), { mode: 0o600 });
  runChild(nativeUrl, remoteFile, "native-crash");
  const [interrupted] = await native`select last_candle_time,position_qty_exact from bot_configs`;
  assert.deepEqual({ ...interrupted }, { last_candle_time: null, position_qty_exact: "0" });
  const [noIntent] = await native`select count(*)::int count from bot_order_intents`;
  assert.equal(noIntent.count, 0, "la caída previa a BUY no creó una intención");
  assert.equal(JSON.parse(await readFile(remoteFile, "utf8")).requests.length, 0);
  for (let restart = 0; restart < 2; restart++) {
    runChild(nativeUrl, remoteFile, "native-recover");
    const [bot] = await native`select last_candle_time,position_qty_exact,invested_usdt_exact,confirmed_stop_price from bot_configs`;
    assert.deepEqual({ ...bot }, { last_candle_time: candleOpenTime, position_qty_exact: "0.999", invested_usdt_exact: "100", confirmed_stop_price: null });
    const remote = JSON.parse(await readFile(remoteFile, "utf8"));
    assert.equal(remote.requests.length, 1);
    assert.equal(remote.requests[0].side, "BUY");
    assert.equal(remote.requests[0].type, "MARKET");
    const [counts] = await native`select (select count(*)::int from bot_order_intents) intents,
      (select count(*)::int from bot_order_fills) fills,(select count(*)::int from bot_trades) trades`;
    assert.deepEqual({ ...counts }, { intents: 1, fills: 1, trades: 1 });
  }
  console.log("✔ Tick DCA real: crash posterior a velas conserva la señal; reinicios compran una vez, consumen la vela y no crean stop");
} finally {
  await sql?.end();
  await restored?.end();
  await native?.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  try { docker("rm", "--force", name); } catch { /* Si falló docker run, no hay contenedor propio. */ }
}
