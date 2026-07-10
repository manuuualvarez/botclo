import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProfiles } from "@/db/schema";
import type { RiskProfile } from "@/lib/strategies/types";

export async function getProfile(
  userId: string
): Promise<RiskProfile | null> {
  const row = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { riskProfile: true },
  });
  return (row?.riskProfile as RiskProfile) ?? null;
}

export async function saveProfile(
  userId: string,
  riskProfile: RiskProfile,
  answers: Record<string, number>
): Promise<void> {
  const values = { userId, riskProfile, answers, updatedAt: new Date() };
  await db
    .insert(userProfiles)
    .values(values)
    .onConflictDoUpdate({ target: userProfiles.userId, set: values });
}
