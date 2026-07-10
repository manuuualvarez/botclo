import { eq } from "drizzle-orm";
import { db } from "@/db";
import { binanceCredentials } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { isTestnet } from "./client";

export async function saveCredentials(
  userId: string,
  apiKey: string,
  apiSecret: string
): Promise<void> {
  const values = {
    userId,
    apiKeyEncrypted: encrypt(apiKey),
    apiSecretEncrypted: encrypt(apiSecret),
    isTestnet: isTestnet(),
    updatedAt: new Date(),
  };
  await db
    .insert(binanceCredentials)
    .values(values)
    .onConflictDoUpdate({ target: binanceCredentials.userId, set: values });
}

export async function getDecryptedCredentials(
  userId: string
): Promise<{ apiKey: string; apiSecret: string } | null> {
  const row = await db.query.binanceCredentials.findFirst({
    where: eq(binanceCredentials.userId, userId),
  });
  if (!row) return null;
  return {
    apiKey: decrypt(row.apiKeyEncrypted),
    apiSecret: decrypt(row.apiSecretEncrypted),
  };
}

export async function hasCredentials(userId: string): Promise<boolean> {
  const row = await db.query.binanceCredentials.findFirst({
    where: eq(binanceCredentials.userId, userId),
    columns: { userId: true },
  });
  return row !== undefined;
}

export async function deleteCredentials(userId: string): Promise<void> {
  await db
    .delete(binanceCredentials)
    .where(eq(binanceCredentials.userId, userId));
}
