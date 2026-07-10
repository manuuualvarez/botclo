"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { deleteCredentials } from "@/lib/binance/credentials";

export async function disconnectBinanceAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  await deleteCredentials(userId);
  revalidatePath("/dashboard");
}
