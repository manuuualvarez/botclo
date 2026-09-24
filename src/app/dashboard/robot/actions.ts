"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { botConfigs, botOrderIntents } from "@/db/schema";
import { BACKTEST_SYMBOLS } from "@/lib/backtest";
import { isTestnet } from "@/lib/binance/client";
import { hasCredentials } from "@/lib/binance/credentials";
import { clampDcaChunk } from "@/lib/bot/decisions";
import { runBotTick } from "@/lib/bot/executor";
import { recordAcceptance } from "@/lib/legal";
import { getEntitlement, plansEnforced } from "@/lib/plan";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { getStrategy } from "@/lib/strategies";
import { withTradingLock } from "@/lib/bot/trading-lock";
import { assertRequestedStatus, removalDecision, tradingActionError, TradingGuardError, withOwnedTradingBot } from "@/lib/bot/trading-guards";

// El intervalo NO se elige: el robot opera con el intervalo para el que la
// estrategia fue diseñada y backtesteada — otro intervalo sería una
// configuración en vivo que ninguna simulación respalda.
const createSchema = z.object({
  strategyId: z.string(),
  symbol: z.enum(BACKTEST_SYMBOLS),
  budget: z.coerce.number().min(25).max(1_000_000),
  aceptaRiesgoReal: z.boolean().optional(),
  params: z.record(z.string(), z.coerce.number()),
});

export interface BotActionState {
  error?: string;
  ok?: boolean;
  // Qué decidió el tick de "Ejecutar ahora": sin esto, un tick que decide
  // no operar parece un botón que no hace nada.
  message?: string;
}

export async function createBotAction(input: unknown): Promise<BotActionState> {
  try {
    return await withTradingLock(() => createBotLocked(input));
  } catch (error) {
    return { error: tradingActionError(error) };
  }
}

async function createBotLocked(input: unknown): Promise<BotActionState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };

  const limited = rateLimit(`bot-create:${userId}`, {
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (!limited.ok) return { error: rateLimitMessage(limited) };

  if (!(await hasCredentials(userId))) {
    return {
      error: "Primero conectá tu cuenta de Binance desde la pestaña Mi cartera.",
    };
  }

  // Límites según el plan del usuario. Los admins NO tienen bypass: se les
  // aplica su plan real (pueden darse una cortesía desde /admin/usuarios).
  const ent = await getEntitlement(userId);
  const limits = ent.limits;

  if (plansEnforced()) {
    if (!limits.modoReal) {
      return {
        error:
          "Para usar robots con dinero real necesitás un plan pago. Podés activarlo desde la pestaña «Mi plan».",
      };
    }
    if (ent.sellOnly) {
      return {
        error:
          "Tu suscripción está en pausa por un pago pendiente: no se pueden crear robots nuevos, pero tus posiciones abiertas siguen protegidas. Regularizá el pago desde «Mi plan».",
      };
    }
  }

  const existing = await db
    .select({ id: botConfigs.id, symbol: botConfigs.symbol })
    .from(botConfigs)
    .where(and(eq(botConfigs.userId, userId), ne(botConfigs.status, "archived")));
  if (existing.length >= limits.maxBots) {
    return {
      error: `Tu plan (${limits.nombre}) permite hasta ${limits.maxBots} robots. Eliminá alguno o subí de plan desde «Mi plan».`,
    };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Revisá los valores del formulario e intentá de nuevo." };
  }
  if (existing.some((bot) => bot.symbol === `${parsed.data.symbol}USDT`)) {
    return { error: "Ya tenés un robot para ese par. Usá el existente para mantener una única posición atribuida." };
  }

  const strategy = getStrategy(parsed.data.strategyId);
  if (!strategy) return { error: "Estrategia desconocida." };

  if (
    plansEnforced() &&
    limits.estrategiasRobot !== null &&
    !limits.estrategiasRobot.includes(strategy.id)
  ) {
    return {
      error: `La estrategia «${strategy.nombre}» está disponible para robots reales en el plan Botclo Pro. Tu plan incluye las estrategias base — podés subir de plan desde «Mi plan».`,
    };
  }

  // Cada parámetro clampado a su rango declarado.
  const params: Record<string, number> = {};
  for (const def of strategy.params) {
    const raw = parsed.data.params[def.key] ?? def.default;
    params[def.key] = Math.min(def.max, Math.max(def.min, raw));
  }
  if (strategy.modo === "dca") {
    params.montoPorCompra = clampDcaChunk(
      parsed.data.params.montoPorCompra,
      parsed.data.budget
    );
  }

  // En modo real exigimos y registramos el consentimiento informado, con un
  // snapshot de la configuración exacta que se aceptó (prueba ante reclamo).
  if (!isTestnet()) {
    if (!parsed.data.aceptaRiesgoReal) {
      return {
        error:
          "Para operar con dinero real tenés que confirmar el aviso de riesgo.",
      };
    }
    await recordAcceptance(userId, "robot_real", {
      strategyId: strategy.id,
      symbol: `${parsed.data.symbol}USDT`,
      interval: strategy.intervalo,
      budgetUsdt: parsed.data.budget,
      params,
    });
  }

  await db.insert(botConfigs).values({
    userId,
    strategyId: strategy.id,
    symbol: `${parsed.data.symbol}USDT`,
    interval: strategy.intervalo,
    budgetUsdt: parsed.data.budget,
    params,
    status: "active",
  });

  revalidatePath("/dashboard/robot");
  return { ok: true };
}

// Devuelve el bot solo si pertenece al usuario autenticado.
async function ownedBot(userId: string, botId: number) {
  return db.query.botConfigs.findFirst({
    where: and(eq(botConfigs.id, botId), eq(botConfigs.userId, userId)),
  });
}

export async function setBotStatusAction(
  botId: number,
  status: unknown
): Promise<BotActionState> {
  try {
    const nextStatus = assertRequestedStatus(status);
    await withOwnedTradingBot(botId, { withLock: withTradingLock, authenticate: async () => (await auth()).userId, readBot: ownedBot }, async (bot) => {
      if (nextStatus === "active" && bot.recoveryState === "review") throw new TradingGuardError("Este robot necesita conciliación antes de reanudar nuevas decisiones.");
      // Pausar no cancela ni reemplaza la orden de protección en Binance.
      await db.update(botConfigs).set({ status: nextStatus, updatedAt: new Date() }).where(eq(botConfigs.id, bot.id));
    });
  } catch (error) { return { error: tradingActionError(error) }; }
  revalidatePath("/dashboard/robot");
  return { ok: true };
}

export async function deleteBotAction(botId: number): Promise<BotActionState> {
  try {
    await withOwnedTradingBot(botId, { withLock: withTradingLock, authenticate: async () => (await auth()).userId, readBot: ownedBot }, async (bot) => {
      const intents = await db.select().from(botOrderIntents).where(eq(botOrderIntents.botId, bot.id));
      const decision = removalDecision(bot, intents);
      if (decision.kind === "blocked") throw new TradingGuardError(decision.error);
      if (decision.kind === "archive") {
        await db.update(botConfigs).set({ status: "archived", updatedAt: new Date() }).where(eq(botConfigs.id, bot.id));
      } else {
        await db.delete(botConfigs).where(eq(botConfigs.id, bot.id));
      }
    });
  } catch (error) { return { error: tradingActionError(error) }; }
  revalidatePath("/dashboard/robot");
  return { ok: true };
}

// "Ejecutar ahora": corre un tick solo para ese robot (ideal para probar).
export async function runMyBotNowAction(
  botId: number
): Promise<BotActionState> {
  const { userId } = await auth();
  if (!userId) return { error: "Tu sesión expiró. Volvé a ingresar." };
  if (!Number.isSafeInteger(botId) || botId <= 0) return { error: "El identificador del robot no es válido." };

  const limited = rateLimit(`bot-run:${userId}`, {
    limit: 10,
    windowMs: 5 * 60_000,
  });
  if (!limited.ok) return { error: rateLimitMessage(limited) };

  const bot = await ownedBot(userId, botId);
  if (!bot || bot.status === "archived") return { error: "No encontramos ese robot." };

  let outcome;
  try { outcome = await runBotTick(bot); }
  catch (error) { return { error: tradingActionError(error) }; }
  revalidatePath("/dashboard/robot");
  if (outcome.action === "error") return { error: outcome.detail };

  const amigable: Record<string, string> = {
    "sin vela nueva":
      "El robot ya había revisado la última vela cerrada: va a decidir de nuevo cuando cierre la próxima vela.",
    "vela ya procesada por otra ejecución":
      "Otra revisión estaba corriendo al mismo tiempo y ya se ocupó de esta vela.",
    "señal: hold":
      "El robot revisó la última vela y la estrategia no dio señal de comprar ni de vender.",
  };
  return {
    ok: true,
    message: amigable[outcome.detail] ?? `Resultado: ${outcome.detail}.`,
  };
}
