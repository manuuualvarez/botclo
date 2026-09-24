// Base efímera exclusiva: nunca reutiliza DATABASE_URL ni el compose de dev.
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const name = `botclo-trading-test-${randomUUID()}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let sql;
let legacy;
let baseline;
try {
  docker("run", "--detach", "--name", name, "--label", "botclo.purpose=trading-tests", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data", "--env", "POSTGRES_USER=botclo_test", "--env", "POSTGRES_PASSWORD=isolated_test_only", "--env", "POSTGRES_DB=botclo_trading_test", "postgres:17-alpine");
  const address = docker("port", name, "5432/tcp");
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error("El puerto de pruebas debe ser loopback.");
  const url = `postgresql://botclo_test:isolated_test_only@${address}/botclo_trading_test`;
  sql = postgres(url, { max: 2, onnotice: () => {} });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await sql`select 1`; ready = true; break; } catch { await setTimeout(100); }
  }
  if (!ready) throw new Error("PostgreSQL exclusivo no quedó disponible.");
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  // La repetición prueba que el historial versionado es reaplicable.
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });

  // Una segunda DB reproduce el esquema viejo y los ALTER manuales que
  // faltaban en el historial: la migración nueva debe tolerar ambos casos.
  await sql`create database botclo_trading_legacy_test`;
  legacy = postgres(url.replace("/botclo_trading_test", "/botclo_trading_legacy_test"), { max: 1, onnotice: () => {} });
  baseline = await mkdtemp(join(tmpdir(), "botclo-migration-test-"));
  await mkdir(join(baseline, "meta"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  await writeFile(join(baseline, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
  await writeFile(join(baseline, "0000_init.sql"), await readFile("drizzle/0000_init.sql"));
  await migrate(drizzle(legacy), { migrationsFolder: baseline });
  await legacy`insert into bot_configs (user_id,strategy_id,symbol,budget_usdt,position_qty,position_avg_price,invested_usdt)
    values ('legacy-migration','dca','BTCUSDT',1000,0.3,100,30)`;
  await legacy`alter table bot_configs add column watched_candle_time double precision`;
  await legacy`alter table telegram_settings add column candle_reports boolean not null default false`;
  await migrate(drizzle(legacy), { migrationsFolder: "./drizzle" });
  await migrate(drizzle(legacy), { migrationsFolder: "./drizzle" });
  const [migrated] = await legacy`select * from bot_configs where user_id='legacy-migration'`;
  assert.equal(migrated.position_qty_exact, "0.3");
  assert.equal(Number(migrated.position_cost_exact), 30);
  assert.equal(migrated.invested_usdt_exact, "30");
  assert.equal(migrated.recovery_state, "legacy");
  assert.equal(migrated.protection_intent_id, null);
  assert.equal(migrated.trading_environment, null);
  await legacy.end();
  legacy = undefined;
  console.log("✔ Migraciones: DB nueva + DB vieja con ALTER manuales + backfill + reaplicación");
  await sql.end();
  sql = undefined;
  const result = spawnSync("pnpm", ["exec", "tsx", "--test", "tests/trading-store.test.mts", "tests/trading-access.test.mts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, BOTCLO_TEST_DATABASE_URL: url, BINANCE_USE_TESTNET: "true", ALLOW_REAL_TRADING: "false", ENCRYPTION_KEY: "0".repeat(64) },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await sql?.end();
  await legacy?.end();
  if (baseline) await rm(baseline, { recursive: true, force: true });
  try { docker("rm", "--force", name); } catch { /* No container if creation failed. */ }
}
