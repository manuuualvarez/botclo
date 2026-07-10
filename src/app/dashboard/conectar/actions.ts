"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  apiKeyAllowsWithdrawal,
  BinanceApiError,
  getAccountBalances,
} from "@/lib/binance/client";
import { saveCredentials } from "@/lib/binance/credentials";
import { recordAcceptance } from "@/lib/legal";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";

const schema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(16, "La API Key se ve demasiado corta. Copiala completa desde Binance.")
    .max(256, "La API Key se ve demasiado larga. Revisá que no hayas pegado texto de más."),
  apiSecret: z
    .string()
    .trim()
    .min(16, "La clave secreta se ve demasiado corta. Copiala completa desde Binance.")
    .max(256, "La clave secreta se ve demasiado larga. Revisá que no hayas pegado texto de más."),
});

export interface ConnectState {
  error?: string;
}

export async function connectBinanceAction(
  _prev: ConnectState,
  formData: FormData
): Promise<ConnectState> {
  const { userId } = await auth();
  if (!userId) {
    return { error: "Tu sesión expiró. Recargá la página y volvé a ingresar." };
  }

  // Cada intento pega a la API de Binance: limitamos para evitar abuso.
  const limited = rateLimit(`connect:${userId}`, {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!limited.ok) return { error: rateLimitMessage(limited) };

  // Error típico: generar una clave RSA en vez de HMAC y pegar la public key.
  const rawSecret = String(formData.get("apiSecret") ?? "");
  if (rawSecret.includes("BEGIN PUBLIC KEY") || rawSecret.includes("-----")) {
    return {
      error:
        "Eso parece una clave pública RSA. Generaste el tipo de clave equivocado: volvé a Binance y usá el botón «Generate HMAC_SHA256 Key», que te da una API Key y una Secret Key.",
    };
  }

  // Aceptación legal obligatoria (mandato + titularidad + sin retiro).
  if (formData.get("acepta") !== "on") {
    return {
      error:
        "Necesitás confirmar la casilla de autorización para conectar tu cuenta.",
    };
  }

  const parsed = schema.safeParse({
    apiKey: formData.get("apiKey"),
    apiSecret: formData.get("apiSecret"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Antes de guardar, probamos las credenciales contra Binance: si no sirven
  // para leer la cuenta, no tiene sentido almacenarlas.
  try {
    await getAccountBalances(parsed.data.apiKey, parsed.data.apiSecret);
  } catch (error) {
    if (error instanceof BinanceApiError) {
      return { error: error.friendlyMessage };
    }
    return {
      error:
        "No pudimos comunicarnos con Binance. Revisá tu conexión a internet e intentá de nuevo.",
    };
  }

  // Seguridad: en modo real, rechazamos claves con permiso de retiro.
  const allowsWithdrawal = await apiKeyAllowsWithdrawal(
    parsed.data.apiKey,
    parsed.data.apiSecret
  );
  if (allowsWithdrawal === true) {
    return {
      error:
        "Esta API key tiene permiso de retiro habilitado. Por tu seguridad no la aceptamos: creá una nueva en Binance SIN el permiso «Enable Withdrawals» y volvé a intentar.",
    };
  }

  await saveCredentials(userId, parsed.data.apiKey, parsed.data.apiSecret);
  await recordAcceptance(userId, "binance_connect");
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
