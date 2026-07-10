"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { saveProfile } from "@/lib/profile";
import { quizQuestions, scoreToProfile } from "@/lib/quiz";
import type { RiskProfile } from "@/lib/strategies/types";

const answersSchema = z.record(z.string(), z.number().int().min(0).max(2));

export interface SaveProfileState {
  profile?: RiskProfile;
  error?: string;
}

export async function saveProfileAction(
  answers: Record<string, number>
): Promise<SaveProfileState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };

  const parsed = answersSchema.safeParse(answers);
  if (
    !parsed.success ||
    quizQuestions.some((q) => parsed.data[q.key] === undefined)
  ) {
    return { error: "Faltan respuestas del cuestionario. Completalo de nuevo." };
  }

  // El puntaje se calcula en el servidor: no confiamos en el del cliente.
  const total = quizQuestions.reduce(
    (sum, q) => sum + parsed.data[q.key],
    0
  );
  const profile = scoreToProfile(total);
  await saveProfile(userId, profile, parsed.data);
  revalidatePath("/dashboard");
  return { profile };
}
