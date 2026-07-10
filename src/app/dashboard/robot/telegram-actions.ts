"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { detectChatId, sendTelegramMessage } from "@/lib/telegram";
import {
  deleteTelegramSettings,
  getTelegramCredentials,
  saveTelegramSettings,
  setTelegramEnabled,
} from "@/lib/telegram-settings";
import { isTestnet } from "@/lib/binance/client";

const tokenSchema = z
  .string()
  .trim()
  .regex(
    /^\d+:[A-Za-z0-9_-]{30,}$/,
    "Ese token no tiene la pinta correcta (debería ser algo como 123456789:AAH...). Copialo completo desde BotFather."
  );

export interface TelegramActionState {
  ok?: boolean;
  error?: string;
  chatId?: string;
  chatName?: string;
}

// Busca el chat del usuario leyendo los últimos mensajes que recibió su bot.
export async function detectChatIdAction(input: {
  token: string;
}): Promise<TelegramActionState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };

  const limited = rateLimit(`tg-detect:${userId}`, {
    limit: 10,
    windowMs: 5 * 60_000,
  });
  if (!limited.ok) return { error: rateLimitMessage(limited) };

  const parsed = tokenSchema.safeParse(input.token);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const detected = await detectChatId(parsed.data);
    if (!detected) {
      return {
        error:
          "Tu bot todavía no recibió ningún mensaje. Abrí el chat con tu bot en Telegram, mandale un «hola» y volvé a intentar.",
      };
    }
    return { ok: true, chatId: detected.chatId, chatName: detected.name };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error con Telegram." };
  }
}

export async function saveTelegramAction(input: {
  token: string;
  chatId: string;
}): Promise<TelegramActionState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };

  const parsedToken = tokenSchema.safeParse(input.token);
  if (!parsedToken.success) {
    return { error: parsedToken.error.issues[0].message };
  }
  const chatId = String(input.chatId ?? "").trim();
  if (!/^-?\d+$/.test(chatId)) {
    return { error: "Falta detectar el chat: usá el botón «Detectar mi chat»." };
  }

  // Verificación real antes de guardar: mandamos el mensaje de bienvenida.
  const sent = await sendTelegramMessage(
    parsedToken.data,
    chatId,
    "✅ ¡Listo! Botclo te va a avisar por acá cada vez que tu robot compre o venda."
  );
  if (!sent.ok) {
    return {
      error: `Telegram no aceptó el envío: ${sent.error}. Revisá el token y que le hayas mandado un mensaje a tu bot.`,
    };
  }

  await saveTelegramSettings(userId, parsedToken.data, chatId);
  revalidatePath("/dashboard/robot");
  return { ok: true };
}

export async function sendTestTelegramAction(): Promise<TelegramActionState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };

  const limited = rateLimit(`tg-test:${userId}`, {
    limit: 5,
    windowMs: 5 * 60_000,
  });
  if (!limited.ok) return { error: rateLimitMessage(limited) };

  const creds = await getTelegramCredentials(userId);
  if (!creds) return { error: "No hay una configuración de Telegram activa." };

  const modo = isTestnet()
    ? "🧪 MODO PRÁCTICA (testnet)"
    : "💰 DINERO REAL";
  const sent = await sendTelegramMessage(
    creds.token,
    creds.chatId,
    `🔔 Mensaje de prueba de Botclo.\n${modo}\nAsí te vamos a avisar cada operación del robot.`
  );
  if (!sent.ok) return { error: `Telegram devolvió un error: ${sent.error}` };
  return { ok: true };
}

export async function setTelegramEnabledAction(
  enabled: boolean
): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  await setTelegramEnabled(userId, enabled);
  revalidatePath("/dashboard/robot");
}

export async function deleteTelegramAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  await deleteTelegramSettings(userId);
  revalidatePath("/dashboard/robot");
}
