import { test } from "node:test";
import assert from "node:assert/strict";
import {
  removalDecision, assertCanDisconnect, assertCredentialEnvironment,
  assertCredentialRotation, needsPreviousAccount, withOwnedTradingBot, assertRequestedStatus,
  type GuardBot,
} from "../src/lib/bot/trading-guards";

function bot(patch: Partial<GuardBot> = {}): GuardBot {
  return { id: 1, userId: "owner", status: "active", symbol: "BTCUSDT", positionQty: 0, positionQtyExact: "0",
    recoveryState: "ready", tradingEnvironment: "testnet", exchangeAccountId: "123", protectionIntentId: null,
    confirmedStopPrice: null, ...patch };
}

test("eliminar/desconectar bloquea posición exacta aunque float sea cero, y viceversa", () => {
  for (const b of [bot({ positionQtyExact: "0.00000000000001" }), bot({ positionQty: 0.3 })]) {
    assert.equal(removalDecision(b, []).kind, "blocked");
    assert.throws(() => assertCanDisconnect([b], []), /posición|operaci/i);
  }
});

test("unknown/planned/submitting/open/review bloquean borrado sin inferir posición cero", () => {
  for (const state of ["unknown", "planned", "submitting", "open", "review"]) {
    const intents = [{ botId: 1, state }];
    assert.equal(removalDecision(bot(), intents).kind, "blocked");
    assert.throws(() => assertCanDisconnect([bot()], intents));
  }
  assert.equal(removalDecision(bot({ protectionIntentId: "pending-stop" }), []).kind, "blocked");
  assert.equal(removalDecision(bot({ confirmedStopPrice: "90" }), []).kind, "blocked");
});

test("historial terminal se archiva; robot vacío sin journal se puede borrar", () => {
  for (const state of ["filled", "canceled", "rejected"]) {
    assert.equal(removalDecision(bot(), [{ botId: 1, state }]).kind, "archive");
    assert.doesNotThrow(() => assertCanDisconnect([bot()], [{ botId: 1, state }]));
  }
  assert.equal(removalDecision(bot(), []).kind, "delete");
});

test("review y cantidades corruptas fallan cerrado", () => {
  for (const b of [bot({ recoveryState: "review" }), bot({ positionQtyExact: "NaN" }), bot({ positionQty: NaN }), bot({ positionQtyExact: "-1" })]) {
    assert.equal(removalDecision(b, []).kind, "blocked");
  }
});

test("estado e id se validan en runtime sin confiar en tipos TypeScript", async () => {
  for (const value of ["archived", "deleted", undefined, {}, 1]) assert.throws(() => assertRequestedStatus(value));
  assert.equal(assertRequestedStatus("paused"), "paused");
  assert.equal(assertRequestedStatus("active"), "active");
});

test("ownership y autenticación se consultan dentro del lock; foreign/no-session jamás muta", async () => {
  const events: string[] = [];
  const deps = {
    withLock: async <T,>(work: () => Promise<T>) => { events.push("lock"); return work(); },
    authenticate: async () => { events.push("auth"); return "owner"; },
    readBot: async () => { events.push("read"); return bot(); },
  };
  await withOwnedTradingBot(1, deps, async () => { events.push("mutate"); });
  assert.deepEqual(events, ["lock", "auth", "read", "mutate"]);
  let mutated = false;
  for (const override of [{ authenticate: async () => null }, { readBot: async () => bot({ userId: "foreign" }) }]) {
    await assert.rejects(withOwnedTradingBot(1, { ...deps, ...override }, async () => { mutated = true; }));
  }
  await assert.rejects(withOwnedTradingBot("1", deps, async () => { mutated = true; }));
  assert.equal(mutated, false);
});

test("credenciales de otro entorno se rechazan antes de descifrar o pedir saldo", () => {
  assert.throws(() => assertCredentialEnvironment(false, "testnet"), /entorno/i);
  assert.throws(() => assertCredentialEnvironment(true, "mainnet"), /entorno/i);
  assert.doesNotThrow(() => assertCredentialEnvironment(true, "testnet"));
});

test("rotación nativa exige mismo uid y entorno; los balances no identifican cuenta", () => {
  assert.doesNotThrow(() => assertCredentialRotation([bot()], [], "testnet", "123"));
  assert.throws(() => assertCredentialRotation([bot()], [], "testnet", "456"), /cuenta/i);
  assert.throws(() => assertCredentialRotation([bot()], [], "mainnet", "123"), /entorno/i);
});

test("legacy expuesto requiere identidad anterior comprobada, no reemplaza key revocada a ciegas", () => {
  const legacy = bot({ recoveryState: "legacy", tradingEnvironment: null, exchangeAccountId: null, positionQty: 0.2 });
  assert.equal(needsPreviousAccount([legacy], []), true);
  assert.throws(() => assertCredentialRotation([legacy], [], "testnet", "123"), /anterior|concili/i);
  assert.throws(() => assertCredentialRotation([legacy], [], "testnet", "123", { environment: "testnet", accountId: "456" }), /cuenta/i);
  assert.doesNotThrow(() => assertCredentialRotation([legacy], [], "testnet", "123", { environment: "testnet", accountId: "123" }));
});

test("robot archivado sin exposición no fija cuenta para siempre; archivado expuesto sí bloquea", () => {
  assert.doesNotThrow(() => assertCredentialRotation([bot({ status: "archived" })], [{ botId: 1, state: "filled" }], "testnet", "456"));
  assert.throws(() => assertCredentialRotation([bot({ status: "archived", positionQtyExact: "1" })], [], "testnet", "456"));
});
