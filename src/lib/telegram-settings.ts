import { eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramSettings } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";

export interface TelegramStatus {
  chatId: string;
  enabled: boolean;
}

export async function getTelegramStatus(
  userId: string
): Promise<TelegramStatus | null> {
  const row = await db.query.telegramSettings.findFirst({
    where: eq(telegramSettings.userId, userId),
    columns: { chatId: true, enabled: true },
  });
  return row ?? null;
}

// Token descifrado + chat, solo para uso interno del servidor (enviar avisos).
export async function getTelegramCredentials(
  userId: string
): Promise<{ token: string; chatId: string } | null> {
  const row = await db.query.telegramSettings.findFirst({
    where: eq(telegramSettings.userId, userId),
  });
  if (!row || !row.enabled) return null;
  return { token: decrypt(row.botTokenEncrypted), chatId: row.chatId };
}

export async function saveTelegramSettings(
  userId: string,
  token: string,
  chatId: string
): Promise<void> {
  const values = {
    userId,
    botTokenEncrypted: encrypt(token),
    chatId,
    enabled: true,
    updatedAt: new Date(),
  };
  await db
    .insert(telegramSettings)
    .values(values)
    .onConflictDoUpdate({ target: telegramSettings.userId, set: values });
}

export async function setTelegramEnabled(
  userId: string,
  enabled: boolean
): Promise<void> {
  await db
    .update(telegramSettings)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(telegramSettings.userId, userId));
}

export async function deleteTelegramSettings(userId: string): Promise<void> {
  await db
    .delete(telegramSettings)
    .where(eq(telegramSettings.userId, userId));
}
