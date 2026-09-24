"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { disconnectTradingAccount } from "@/lib/bot/trading-access";
import { tradingActionError } from "@/lib/bot/trading-guards";

export async function disconnectBinanceAction(): Promise<{ error?: string; ok?: boolean }> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };
  try {
    await disconnectTradingAccount(userId);
  } catch (error) {
    return { error: tradingActionError(error) };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}
