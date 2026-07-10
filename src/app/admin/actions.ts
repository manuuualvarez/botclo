"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { grants } from "@/db/schema";
import { isAdmin } from "@/lib/admin";

const grantSchema = z.object({
  userId: z.string().min(1),
  plan: z.enum(["real", "pro"]),
  months: z.number().int().min(1).max(24).nullable(), // null = sin vencimiento
  motivo: z.string().max(200).optional(),
});

export interface AdminActionState {
  ok?: boolean;
  error?: string;
}

export async function grantAction(input: {
  userId: string;
  plan: string;
  months: number | null;
  motivo?: string;
}): Promise<AdminActionState> {
  const { userId: adminId } = await auth();
  if (!adminId || !(await isAdmin())) return { error: "Solo admins." };

  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos de la cortesía inválidos." };

  const vence =
    parsed.data.months === null
      ? null
      : new Date(Date.now() + parsed.data.months * 30 * 86_400_000);

  // Una cortesía vigente por usuario: las anteriores se revocan.
  await db
    .update(grants)
    .set({ revoked: true })
    .where(and(eq(grants.userId, parsed.data.userId), eq(grants.revoked, false)));
  await db.insert(grants).values({
    userId: parsed.data.userId,
    plan: parsed.data.plan,
    grantedBy: adminId,
    motivo: parsed.data.motivo ?? null,
    vence,
  });

  revalidatePath("/admin/usuarios");
  return { ok: true };
}

const pricesSchema = z.object({
  plan: z.enum(["real", "pro"]),
  mensual: z.coerce.number().min(1000).max(10_000_000),
  anual: z.coerce.number().min(1000).max(100_000_000),
});

export async function updatePlanPricesAction(input: {
  plan: string;
  mensual: number | string;
  anual: number | string;
}): Promise<AdminActionState> {
  const { userId } = await auth();
  if (!userId || !(await isAdmin())) return { error: "Solo admins." };

  const parsed = pricesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Precios inválidos (mínimo ARS 1.000)." };
  }

  const { setPlanPrices } = await import("@/lib/plan-prices");
  await setPlanPrices(parsed.data.plan, parsed.data.mensual, parsed.data.anual);
  revalidatePath("/admin/planes");
  revalidatePath("/dashboard/plan");
  return { ok: true };
}

export async function revokeGrantAction(
  userId: string
): Promise<AdminActionState> {
  const { userId: adminId } = await auth();
  if (!adminId || !(await isAdmin())) return { error: "Solo admins." };

  await db
    .update(grants)
    .set({ revoked: true })
    .where(and(eq(grants.userId, userId), eq(grants.revoked, false)));

  revalidatePath("/admin/usuarios");
  return { ok: true };
}
