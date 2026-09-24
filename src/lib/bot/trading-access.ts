import { eq } from "drizzle-orm";
import { db } from "../../db";
import { binanceCredentials, botConfigs, botOrderIntents } from "../../db/schema";
import { isTestnet } from "../binance/client";
import { deleteCredentials, getDecryptedCredentials, saveCredentials } from "../binance/credentials";
import { BinanceOrderClient, type BinanceEnvironment } from "../binance/orders";
import { assertCanDisconnect, assertCredentialEnvironment, assertCredentialRotation, needsPreviousAccount, TradingGuardError } from "./trading-guards";
import { withTradingLock } from "./trading-lock";

// El lifecycle de trading valida cuenta/exposición antes de delegar al
// almacenamiento cifrado existente. Este módulo no implementa criptografía.
export async function readTradingAccount(userId: string) {
  const row = await db.query.binanceCredentials.findFirst({
    where: eq(binanceCredentials.userId, userId), columns: { isTestnet: true },
  });
  if (!row) return null;
  assertCredentialEnvironment(row.isTestnet, isTestnet() ? "testnet" : "mainnet");
  return getDecryptedCredentials(userId);
}

export async function connectTradingAccount(userId: string, apiKey: string, apiSecret: string): Promise<void> {
  await withTradingLock(async () => {
    const environment: BinanceEnvironment = isTestnet() ? "testnet" : "mainnet";
    const bots = await db.select().from(botConfigs).where(eq(botConfigs.userId, userId));
    const intents = await db.select().from(botOrderIntents).where(eq(botOrderIntents.userId, userId));
    const next = await new BinanceOrderClient({ apiKey, apiSecret, environment }).getAccount();
    let previous: { environment: BinanceEnvironment; accountId: string } | undefined;
    if (needsPreviousAccount(bots, intents)) {
      try {
        const old = await readTradingAccount(userId);
        if (old) {
          const account = await new BinanceOrderClient({ ...old, environment }).getAccount();
          previous = { environment, accountId: account.uid };
        }
      } catch {
        throw new TradingGuardError("No pudimos verificar la cuenta anterior. Conciliá las posiciones antes de reemplazar sus claves.");
      }
    }
    assertCredentialRotation(bots, intents, environment, next.uid, previous);
    await saveCredentials(userId, apiKey, apiSecret);
  });
}

export async function disconnectTradingAccount(userId: string): Promise<void> {
  await withTradingLock(async () => {
    const bots = await db.select().from(botConfigs).where(eq(botConfigs.userId, userId));
    const intents = await db.select().from(botOrderIntents).where(eq(botOrderIntents.userId, userId));
    assertCanDisconnect(bots, intents);
    await deleteCredentials(userId);
  });
}
