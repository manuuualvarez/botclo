import { and, eq, sql } from "drizzle-orm";
import { db, pg } from "@/db";
import { botConfigs, botTrades } from "@/db/schema";
import {
  BinanceApiError,
  getKlines,
  getSpotPrice,
  getSymbolFilters,
  isTestnet,
  placeMarketOrder,
  roundToStep,
} from "@/lib/binance/client";
import { getDecryptedCredentials } from "@/lib/binance/credentials";
import { capturePortfolioSnapshot } from "@/lib/binance/portfolio";
import {
  dcaChunk,
  dcaDue,
  investedAfterSell,
} from "@/lib/bot/decisions";
import { INTERVAL_MS, type KlineInterval } from "@/lib/intervals";
import { getBotInsight } from "@/lib/bot/insight";
import { getEntitlement, plansEnforced } from "@/lib/plan";
import { atrAt, ATR_WINDOW, initialStop, trailedStop } from "@/lib/risk";
import {
  defaultParams,
  evalSignal,
  getStrategy,
  signalWindow,
} from "@/lib/strategies";
import { sendTelegramMessage } from "@/lib/telegram";
import { getTelegramCredentials } from "@/lib/telegram-settings";

// Ejecutor del robot. Por tick y por bot:
// 1. Chequea el stop de protección contra el precio ACTUAL (cada minuto).
// 2. Si hay vela nueva cerrada: actualiza el trailing, evalúa la señal de la
//    estrategia y ejecuta a lo sumo una orden MARKET.
// Idempotencia: cada vela cerrada se procesa una sola vez (last_candle_time).

export type BotConfig = typeof botConfigs.$inferSelect;

export interface TickOutcome {
  botId: number;
  userId: string;
  action: "buy" | "sell" | "hold" | "skip" | "error";
  detail: string;
}

// Lock global del tick: si un barrido tarda más que el intervalo del
// scheduler, el siguiente `curl` no arranca en paralelo. Un solo tick
// procesa los bots a la vez; los demás salen sin hacer nada.
const TICK_LOCK_KEY = 918_273_645;

// Prefijos del lastError de una orden en reintento. La dedup de alertas de
// Telegram compara contra ESTAS constantes — no reescribir el texto en un
// solo lado, o el usuario recibe una alerta por tick.
const SELL_RETRY_PREFIX = "La venta falló y se va a reintentar";
const BUY_RETRY_PREFIX = "La compra falló y se va a reintentar";

export async function runAllActiveBots(): Promise<TickOutcome[]> {
  // Lock de sesión sobre una conexión RESERVADA: lock y unlock viven
  // garantizados en la MISMA conexión (a través del pool podían caer en
  // conexiones distintas — el unlock fallaba en silencio y el lock quedaba
  // tomado para siempre, matando todos los ticks siguientes). Si el proceso
  // muere, el socket se cierra y Postgres libera el lock solo. No queda
  // ninguna transacción abierta durante el barrido (que incluye llamadas
  // HTTP): el resto de las queries usa el pool normal.
  const reserved = await pg.reserve();
  try {
    const [{ locked }] = (await reserved`
      SELECT pg_try_advisory_lock(${TICK_LOCK_KEY}) AS locked
    `) as unknown as { locked: boolean }[];
    if (!locked) return [];

    try {
      const bots = await db
        .select()
        .from(botConfigs)
        .where(eq(botConfigs.status, "active"));

      const outcomes: TickOutcome[] = [];
      for (const bot of bots) {
        outcomes.push(await runBotTick(bot));
      }

      // Vigía de robots pausados: no operan, pero el usuario tiene que
      // enterarse si el mercado les está pidiendo algo. Nunca rompe el tick.
      const paused = await db
        .select()
        .from(botConfigs)
        .where(eq(botConfigs.status, "paused"));
      for (const bot of paused) {
        try {
          await watchPausedBot(bot);
        } catch {
          // el vigía es best-effort
        }
      }

      // Snapshot del valor de cartera por usuario (throttled a 1/hora adentro).
      for (const userId of new Set(bots.map((b) => b.userId))) {
        try {
          await capturePortfolioSnapshot(userId);
        } catch {
          // el snapshot nunca debe romper el tick
        }
      }
      return outcomes;
    } finally {
      await reserved`SELECT pg_advisory_unlock(${TICK_LOCK_KEY})`;
    }
  } finally {
    reserved.release();
  }
}

async function updateBot(
  botId: number,
  set: Partial<typeof botConfigs.$inferInsert>
) {
  await db
    .update(botConfigs)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(botConfigs.id, botId));
}

// Reserva atómica de la vela: avanza last_candle_time solo si todavía no fue
// procesada. Si dos ejecuciones concurrentes (scheduler + "Ejecutar ahora")
// llegan a la misma vela, solo UNA gana el UPDATE — la otra recibe 0 filas y
// aborta, evitando una compra MARKET duplicada. `IS DISTINCT FROM` maneja el
// caso NULL (primera corrida) correctamente.
async function claimCandle(
  botId: number,
  candleOpenTime: number
): Promise<boolean> {
  const claimed = await db
    .update(botConfigs)
    .set({ lastCandleTime: candleOpenTime, lastRunAt: new Date() })
    .where(
      and(
        eq(botConfigs.id, botId),
        sql`${botConfigs.lastCandleTime} IS DISTINCT FROM ${candleOpenTime}`
      )
    )
    .returning({ id: botConfigs.id });
  return claimed.length > 0;
}

async function recordTrade(
  bot: BotConfig,
  side: "BUY" | "SELL",
  qty: number,
  price: number,
  quoteQty: number,
  orderId: number,
  reason: string
) {
  await db.insert(botTrades).values({
    botId: bot.id,
    userId: bot.userId,
    strategyId: bot.strategyId,
    symbol: bot.symbol,
    side,
    qty,
    price,
    quoteQty,
    binanceOrderId: orderId,
    reason,
    isTestnet: isTestnet(),
  });
}

const usd = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function errorText(error: unknown): string {
  return error instanceof BinanceApiError
    ? error.friendlyMessage
    : error instanceof Error
      ? error.message
      : String(error);
}

// Falla de orden que NO se descarta: devuelve la vela reclamada para que el
// próximo tick (o "Ejecutar ahora") reintente. El UPDATE es condicional a que
// la vela siga siendo la nuestra, para no pisar a una ejecución concurrente
// que ya avanzó. Telegram avisa solo en la primera falla, no por tick
// (dedup por prefijo en lastError).
async function retryNextTick(
  bot: BotConfig,
  claimedCandleTime: number,
  now: Date,
  prefix: string,
  message: string,
  alertText: string
) {
  if (!bot.lastError?.startsWith(prefix)) {
    await notifyAlert(bot, alertText);
  }
  await db
    .update(botConfigs)
    .set({
      lastCandleTime: bot.lastCandleTime,
      lastRunAt: now,
      lastError: `${prefix}: ${message}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(botConfigs.id, bot.id),
        eq(botConfigs.lastCandleTime, claimedCandleTime)
      )
    );
}

// Alerta operativa por Telegram (si está configurado). Nunca rompe el tick.
async function notifyAlert(bot: BotConfig, text: string) {
  try {
    const creds = await getTelegramCredentials(bot.userId);
    if (!creds) return;
    await sendTelegramMessage(creds.token, creds.chatId, text);
  } catch {
    // sin Telegram no pasa nada
  }
}

// Parte de vela por Telegram (opt-in): al cierre de cada vela de decisión el
// usuario recibe qué vio y qué decidió el robot — la prueba de vida que falta
// cuando el robot decide NO operar. Nunca rompe el tick.
async function notifyCandleReport(
  bot: BotConfig,
  strategyName: string,
  interval: string,
  decision: string
) {
  try {
    const creds = await getTelegramCredentials(bot.userId);
    if (!creds?.candleReports) return;
    const insight = await getBotInsight(bot);
    await sendTelegramMessage(
      creds.token,
      creds.chatId,
      [
        `🕯️ <b>${bot.symbol}</b> · ${strategyName}`,
        `Cerró una vela de ${interval} y el robot revisó el mercado: ${decision}.`,
        ...(insight ? [`👀 ${insight}`] : []),
      ].join("\n")
    );
  } catch {
    // sin Telegram no pasa nada
  }
}

// Vigía de robots pausados: en pausa el robot no compra, no vende y NO
// protege la posición con el stop — pero el mercado sigue. Al cierre de cada
// vela evalúa la señal en solo-lectura y avisa por Telegram si el robot
// hubiera actuado; la decisión de reanudar es del usuario. No toca
// last_candle_time: si el usuario reanuda dentro de la ventana de gracia,
// el robot todavía agarra la entrada de verdad.
async function watchPausedBot(bot: BotConfig): Promise<void> {
  const strategy = getStrategy(bot.strategyId);
  // El DCA pausado no pierde nada irrecuperable: la próxima compra llega sola.
  if (!strategy || strategy.modo === "dca") return;

  const params = {
    ...defaultParams(strategy),
    ...(bot.params as Record<string, number>),
  };
  const window = Math.max(signalWindow(strategy, params), ATR_WINDOW);
  const candles = await getKlines(
    bot.symbol,
    strategy.intervalo,
    Math.min(1000, window + 1)
  );
  const closed = candles.slice(0, -1);
  const i = closed.length - 1;
  if (closed.length < strategy.warmup(params) + 1) return;
  const lastCandle = closed[i];
  if (bot.watchedCandleTime === lastCandle.openTime) return;

  const price = lastCandle.close;
  const hasPosition = bot.positionQty * price >= 5;
  const signal = evalSignal(strategy, closed, i, params);

  let estado = "pausado: sin señal";
  let aviso: string | null = null;
  if (hasPosition && bot.stopPrice !== null && price <= bot.stopPrice) {
    estado = "pausado: el precio perforó el stop";
    aviso = `⏸️🚨 ${bot.symbol}: el robot está PAUSADO y el precio (${usd.format(price)}) perforó su stop de protección (${usd.format(bot.stopPrice)}). La posición NO está protegida mientras siga en pausa — reanudalo o vendé a mano.`;
  } else if (signal === "sell" && hasPosition) {
    estado = "pausado: hubiera vendido";
    aviso = `⏸️ ${bot.symbol}: la estrategia dio señal de VENTA, pero el robot está pausado y no vendió. Reanudalo si querés que gestione la salida.`;
  } else if (signal === "buy" && !hasPosition) {
    estado = "pausado: hubiera comprado";
    aviso = `⏸️ ${bot.symbol}: la estrategia dio señal de COMPRA, pero el robot está pausado y no compró. La señal sigue vigente por unas velas: reanudalo desde la app si querés que entre.`;
  }

  // Dedup: avisamos solo cuando el estado CAMBIA — una señal que dura varias
  // velas genera UN aviso; si desaparece y vuelve a aparecer, avisa de nuevo.
  if (aviso && bot.lastSignal !== estado) {
    await notifyAlert(bot, aviso);
  }
  await updateBot(bot.id, {
    watchedCandleTime: lastCandle.openTime,
    lastRunAt: new Date(),
    lastSignal: estado,
  });
}

// Aviso de operación por Telegram: arma el mensaje y delega el envío.
async function notifyTrade(
  bot: BotConfig,
  strategyName: string,
  side: "BUY" | "SELL",
  qty: number,
  price: number,
  quoteQty: number,
  reason: string
) {
  const modo = isTestnet()
    ? "🧪 <b>MODO PRÁCTICA (testnet)</b>"
    : "💰 <b>DINERO REAL</b>";
  const encabezado = side === "BUY" ? "🟢 <b>COMPRA</b>" : "🔴 <b>VENTA</b>";
  await notifyAlert(
    bot,
    [
      modo,
      `${encabezado} ${bot.symbol}`,
      `Cantidad: ${qty}`,
      `Precio: ${usd.format(price)}`,
      `Total: ${usd.format(quoteQty)}`,
      `Estrategia: ${strategyName}`,
      `Motivo: ${reason}`,
    ].join("\n")
  );
}

export async function runBotTick(bot: BotConfig): Promise<TickOutcome> {
  const now = new Date();
  const out = (action: TickOutcome["action"], detail: string): TickOutcome => ({
    botId: bot.id,
    userId: bot.userId,
    action,
    detail,
  });

  try {
    const strategy = getStrategy(bot.strategyId);
    if (!strategy) return out("skip", "estrategia desconocida");

    const creds = await getDecryptedCredentials(bot.userId);
    if (!creds) {
      await updateBot(bot.id, {
        lastRunAt: now,
        lastError: "No hay una cuenta de Binance conectada.",
      });
      return out("skip", "sin credenciales");
    }

    const params = {
      ...defaultParams(strategy),
      ...(bot.params as Record<string, number>),
    };
    // El intervalo sale de la ESTRATEGIA, no de la fila del bot: es el único
    // backtesteado. Cubre también bots viejos creados cuando se podía elegir.
    const interval: KlineInterval = strategy.intervalo;
    const warmup = strategy.warmup(params);
    const trailMult = params.trailingAtr ?? 0;
    const stopMult = params.stopAtr ?? 0;

    // Facturación (solo en modo real): sin plan con modo real, o con la
    // suscripción en pausa suave, el robot NO abre posiciones nuevas — pero
    // stops y ventas siguen activos: la protección jamás se corta por deuda.
    let buysBlocked = false;
    let buysBlockedReason = "";
    if (plansEnforced()) {
      const ent = await getEntitlement(bot.userId);
      if (!ent.limits.modoReal) {
        buysBlocked = true;
        buysBlockedReason =
          "compras pausadas: tu plan no incluye robots en modo real";
      } else if (ent.sellOnly) {
        buysBlocked = true;
        buysBlockedReason =
          "compras pausadas por un pago pendiente (tus posiciones siguen protegidas)";
      }
    }

    // ---- 1) Stop de protección: se chequea CADA tick contra el precio actual
    // Cierra la posición en DB sin orden (polvo invendible, o el saldo ya no
    // existe en Binance): el robot no puede quedarse "sosteniendo" algo que
    // no puede vender — quedaría congelado para siempre. Lo invertido queda
    // consumido: la pérdida achica el presupuesto, jamás se repone.
    const clearPosition = (extra: Partial<typeof botConfigs.$inferInsert>) =>
      updateBot(bot.id, {
        lastRunAt: now,
        positionQty: 0,
        positionAvgPrice: 0,
        stopPrice: null,
        highestClose: null,
        cooldownUntil: new Date(now.getTime() + INTERVAL_MS[interval]),
        ...extra,
      });

    if (
      strategy.modo !== "dca" &&
      bot.positionQty > 0 &&
      bot.stopPrice !== null
    ) {
      const currentPrice = await getSpotPrice(bot.symbol);
      if (currentPrice !== null && currentPrice <= bot.stopPrice) {
        const filters = await getSymbolFilters(bot.symbol);
        const qty = roundToStep(bot.positionQty, filters.stepSize);
        if (qty >= filters.minQty && qty * currentPrice >= filters.minNotional) {
          let order;
          try {
            order = await placeMarketOrder(creds.apiKey, creds.apiSecret, {
              symbol: bot.symbol,
              side: "SELL",
              quantity: qty,
            });
          } catch (error) {
            // Binance no encuentra el saldo: la posición de la DB está
            // desincronizada (venta manual, retiro). Cerrarla acá — si no,
            // el stop se reintentaría para siempre contra monedas que no
            // existen. Cualquier otro error se propaga y se reintenta.
            if (error instanceof BinanceApiError && error.code === -2010) {
              const msg =
                "No se pudo ejecutar el stop: Binance no encuentra el saldo (¿vendiste o moviste las monedas a mano?). El robot dio la posición por cerrada.";
              await notifyAlert(bot, `⚠️ ${bot.symbol}: ${msg}`);
              await clearPosition({ lastError: msg, lastSignal: "posición desincronizada" });
              return out("error", "stop imposible: posición desincronizada, cerrada");
            }
            throw error;
          }
          const reason = "Stop de protección: el precio tocó el límite de pérdida";
          await recordTrade(bot, "SELL", order.executedQty, order.avgPrice, order.netQuoteQty, order.orderId, reason);
          await clearPosition({
            lastError: null,
            lastSignal: "stop ejecutado",
            investedUsdt: investedAfterSell(bot.investedUsdt, order.netQuoteQty),
          });
          await notifyTrade(bot, strategy.nombre, "SELL", order.executedQty, order.avgPrice, order.cummulativeQuoteQty, reason);
          return out("sell", `stop ejecutado a ${order.avgPrice.toFixed(2)}`);
        }
        // Stop activado pero la posición es polvo invendible: se da por
        // cerrada (el polvo queda en la cuenta) para que el robot siga
        // operando en vez de quedar congelado. Telegram avisa una vez.
        const dustMsg =
          "El stop se activó, pero la posición era demasiado chica para venderla: quedó como polvo en tu cuenta y el robot la dio por cerrada.";
        if (bot.lastError !== dustMsg) {
          await notifyAlert(bot, `⚠️ ${bot.symbol}: ${dustMsg}`);
        }
        await clearPosition({ lastError: dustMsg, lastSignal: "stop con posición polvo" });
        return out("skip", "stop con posición polvo: posición cerrada");
      }
    }

    // ---- 2) Velas cerradas del intervalo de la estrategia. Ventana
    // canónica: las MISMAS velas con las que el backtest evalúa la señal
    // (evalSignal) y el ATR de los stops (risk.ts); +1 por la vela en
    // formación que se descarta.
    const window = Math.max(signalWindow(strategy, params), ATR_WINDOW);
    const candles = await getKlines(
      bot.symbol,
      interval,
      Math.min(1000, window + 1)
    );
    const closed = candles.slice(0, -1); // la última sigue abierta
    if (closed.length < warmup + 1) {
      await updateBot(bot.id, {
        lastRunAt: now,
        lastError:
          "Todavía no hay suficiente historia de precios para esta estrategia.",
      });
      return out("skip", "historia insuficiente");
    }

    const i = closed.length - 1;
    const lastCandle = closed[i];
    const price = lastCandle.close;

    // ---- 3) Idempotencia atómica: reservamos la vela antes de operar.
    // Si otra ejecución ya la tomó (o no hay vela nueva), abortamos acá —
    // así una orden MARKET nunca se dispara dos veces por la misma señal.
    if (bot.lastCandleTime === lastCandle.openTime) {
      await updateBot(bot.id, { lastRunAt: now });
      return out("hold", "sin vela nueva");
    }
    if (!(await claimCandle(bot.id, lastCandle.openTime))) {
      return out("hold", "vela ya procesada por otra ejecución");
    }

    // ---- 4) Vela nueva: actualizar trailing si hay posición.
    let stopPrice = bot.stopPrice;
    let highestClose = bot.highestClose;
    if (bot.positionQty > 0 && trailMult > 0 && strategy.modo !== "dca") {
      highestClose = Math.max(highestClose ?? 0, price);
      stopPrice = trailedStop(
        stopPrice,
        highestClose,
        atrAt(closed, i),
        trailMult
      );
    }

    // El DCA no tiene señal: su cadencia es de calendario (evalSignal lo
    // rechaza a propósito).
    const signal =
      strategy.modo === "dca" ? "hold" : evalSignal(strategy, closed, i, params);
    const base = {
      lastRunAt: now,
      lastError: null as string | null,
      lastCandleTime: lastCandle.openTime,
      stopPrice,
      highestClose,
    };

    // ---- 5a) DCA: compra periódica de monto fijo.
    if (strategy.modo === "dca") {
      if (buysBlocked) {
        await updateBot(bot.id, { ...base, lastSignal: buysBlockedReason });
        await notifyCandleReport(bot, strategy.nombre, interval, buysBlockedReason);
        return out("hold", buysBlockedReason);
      }
      const due = dcaDue(
        bot.lastBuyAt,
        now,
        INTERVAL_MS[interval],
        params.cadaNVelas
      );
      const chunk = dcaChunk(
        params.montoPorCompra,
        bot.budgetUsdt,
        bot.investedUsdt
      );

      if (!due) {
        await updateBot(bot.id, { ...base, lastSignal: "esperando la próxima compra" });
        await notifyCandleReport(bot, strategy.nombre, interval, "todavía no toca la próxima compra periódica");
        return out("hold", "todavía no toca comprar");
      }
      if (chunk < 10) {
        await updateBot(bot.id, { ...base, lastSignal: "presupuesto agotado" });
        await notifyCandleReport(bot, strategy.nombre, interval, "el presupuesto ya está totalmente invertido");
        return out("hold", "presupuesto agotado");
      }
      const filters = await getSymbolFilters(bot.symbol);
      if (chunk < filters.minNotional) {
        await updateBot(bot.id, {
          ...base,
          lastError: `El monto por compra (${chunk.toFixed(2)} USD) está por debajo del mínimo de Binance (${filters.minNotional} USD).`,
        });
        return out("skip", "monto bajo el mínimo");
      }

      let order;
      try {
        order = await placeMarketOrder(creds.apiKey, creds.apiSecret, {
          symbol: bot.symbol,
          side: "BUY",
          quoteOrderQty: chunk,
        });
      } catch (error) {
        // Misma política que la compra por señal: la vela se devuelve y se
        // reintenta el próximo tick (lastBuyAt no cambió, así que sigue
        // "tocando comprar").
        const message = errorText(error);
        await retryNextTick(
          bot,
          lastCandle.openTime,
          now,
          BUY_RETRY_PREFIX,
          message,
          `⚠️ ${bot.symbol}: la compra falló y el robot la va a reintentar en cada revisión. Motivo: ${message}`
        );
        return out("error", `compra fallida, se reintenta: ${message}`);
      }
      const reason = `Compra periódica (${strategy.nombre})`;
      await recordTrade(bot, "BUY", order.netBaseQty, order.avgPrice, order.cummulativeQuoteQty, order.orderId, reason);
      const totalQty = bot.positionQty + order.netBaseQty;
      await updateBot(bot.id, {
        ...base,
        lastSignal: "compró",
        positionQty: totalQty,
        positionAvgPrice:
          totalQty > 0
            ? (bot.positionQty * bot.positionAvgPrice + order.cummulativeQuoteQty) / totalQty
            : 0,
        investedUsdt: bot.investedUsdt + order.cummulativeQuoteQty,
        lastBuyAt: now,
      });
      await notifyTrade(bot, strategy.nombre, "BUY", order.executedQty, order.avgPrice, order.cummulativeQuoteQty, reason);
      return out("buy", `compró por ${order.cummulativeQuoteQty.toFixed(2)} USDT`);
    }

    // ---- 5b) Estrategias all-in/all-out.
    const hasPosition = bot.positionQty * price >= 5;
    const inCooldown =
      bot.cooldownUntil !== null && bot.cooldownUntil.getTime() > now.getTime();

    if (signal === "buy" && buysBlocked) {
      await updateBot(bot.id, { ...base, lastSignal: buysBlockedReason });
      await notifyCandleReport(bot, strategy.nombre, interval, buysBlockedReason);
      return out("hold", buysBlockedReason);
    }

    if (signal === "buy" && !hasPosition && !inCooldown) {
      const spend = bot.budgetUsdt - bot.investedUsdt;
      const filters = await getSymbolFilters(bot.symbol);
      if (spend < Math.max(10, filters.minNotional)) {
        await updateBot(bot.id, {
          ...base,
          lastError: "No queda presupuesto suficiente para comprar.",
        });
        return out("skip", "sin presupuesto");
      }
      let order;
      try {
        order = await placeMarketOrder(creds.apiKey, creds.apiSecret, {
          symbol: bot.symbol,
          side: "BUY",
          quoteOrderQty: spend,
        });
      } catch (error) {
        // Una compra fallida tampoco se descarta: se devuelve la vela y se
        // reintenta cada tick mientras la señal siga vigente. El caso real
        // que motivó esto: Binance Earn barrió los USDT de Spot y la compra
        // falló — sin reintento, la vela quedaba consumida y "Ejecutar
        // ahora" no hacía nada hasta la vela siguiente.
        const message = errorText(error);
        await retryNextTick(
          bot,
          lastCandle.openTime,
          now,
          BUY_RETRY_PREFIX,
          message,
          `⚠️ ${bot.symbol}: la compra falló y el robot la va a reintentar en cada revisión. Motivo: ${message}`
        );
        return out("error", `compra fallida, se reintenta: ${message}`);
      }
      const reason = `Señal de compra (${strategy.nombre})`;
      await recordTrade(bot, "BUY", order.netBaseQty, order.avgPrice, order.cummulativeQuoteQty, order.orderId, reason);
      await updateBot(bot.id, {
        ...base,
        lastSignal: "compró",
        positionQty: bot.positionQty + order.netBaseQty,
        positionAvgPrice:
          order.netBaseQty > 0
            ? order.cummulativeQuoteQty / order.netBaseQty
            : order.avgPrice,
        investedUsdt: bot.investedUsdt + order.cummulativeQuoteQty,
        lastBuyAt: now,
        stopPrice: initialStop(order.avgPrice, atrAt(closed, i), stopMult),
        highestClose: order.avgPrice,
      });
      await notifyTrade(bot, strategy.nombre, "BUY", order.executedQty, order.avgPrice, order.cummulativeQuoteQty, reason);
      return out("buy", `compró por ${order.cummulativeQuoteQty.toFixed(2)} USDT`);
    }

    if (signal === "sell" && hasPosition) {
      const filters = await getSymbolFilters(bot.symbol);
      const qty = roundToStep(bot.positionQty, filters.stepSize);
      if (qty < filters.minQty || qty * price < filters.minNotional) {
        await updateBot(bot.id, {
          ...base,
          lastError:
            "La posición es demasiado chica para venderla (queda como polvo).",
        });
        return out("skip", "posición mínima");
      }
      let order;
      try {
        order = await placeMarketOrder(creds.apiKey, creds.apiSecret, {
          symbol: bot.symbol,
          side: "SELL",
          quantity: qty,
        });
      } catch (error) {
        // Posición desincronizada (venta manual, retiro): reintentar sería
        // pedirle a Binance para siempre monedas que no existen — se cierra.
        if (error instanceof BinanceApiError && error.code === -2010) {
          const msg =
            "No se pudo vender: Binance no encuentra el saldo (¿vendiste o moviste las monedas a mano?). El robot dio la posición por cerrada.";
          await notifyAlert(bot, `⚠️ ${bot.symbol}: ${msg}`);
          await updateBot(bot.id, {
            ...base,
            lastError: msg,
            lastSignal: "posición desincronizada",
            positionQty: 0,
            positionAvgPrice: 0,
            stopPrice: null,
            highestClose: null,
          });
          return out("error", "venta imposible: posición desincronizada, cerrada");
        }
        // Cualquier otra falla: una señal de venta NUNCA se descarta —
        // devolvemos la vela reclamada para que el próximo tick reintente
        // (una venta fallida dejaría la posición sin salida).
        const message = errorText(error);
        await retryNextTick(
          bot,
          lastCandle.openTime,
          now,
          SELL_RETRY_PREFIX,
          message,
          `⚠️ ${bot.symbol}: la venta falló y el robot la va a reintentar en cada revisión. Motivo: ${message}`
        );
        return out("error", `venta fallida, se reintenta: ${message}`);
      }
      const reason = `Señal de venta (${strategy.nombre})`;
      await recordTrade(bot, "SELL", order.executedQty, order.avgPrice, order.netQuoteQty, order.orderId, reason);
      await updateBot(bot.id, {
        ...base,
        lastSignal: "vendió",
        positionQty: 0,
        positionAvgPrice: 0,
        // Lo que se perdió en esta ronda queda consumido del presupuesto —
        // el robot no repone plata del wallet (misma regla que el backtest).
        investedUsdt: investedAfterSell(bot.investedUsdt, order.netQuoteQty),
        stopPrice: null,
        highestClose: null,
      });
      await notifyTrade(bot, strategy.nombre, "SELL", order.executedQty, order.avgPrice, order.cummulativeQuoteQty, reason);
      return out("sell", `vendió por ${order.cummulativeQuoteQty.toFixed(2)} USDT`);
    }

    await updateBot(bot.id, {
      ...base,
      lastSignal:
        signal === "hold"
          ? hasPosition
            ? "manteniendo la posición"
            : "sin señal, esperando"
          : `señal ${signal} (sin acción)`,
    });
    // El parte cuenta POR QUÉ no hubo acción — sin esto, "el robot revisó y
    // no hizo nada" parece un robot roto.
    const decision =
      signal === "hold"
        ? hasPosition
          ? "decidió mantener la posición"
          : "sin señal de compra ni de venta, sigue esperando"
        : signal === "buy"
          ? hasPosition
            ? "la señal de compra sigue vigente y el robot ya está comprado"
            : "hay señal de compra, pero el robot está en enfriamiento tras un stop reciente"
          : "la estrategia marca venta, pero el robot no tiene posición abierta";
    await notifyCandleReport(bot, strategy.nombre, interval, decision);
    return out("hold", `señal: ${signal}`);
  } catch (error) {
    const message = errorText(error);
    await updateBot(bot.id, { lastRunAt: now, lastError: message }).catch(
      () => {}
    );
    return out("error", message);
  }
}
