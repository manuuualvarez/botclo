import { getKlines } from "@/lib/binance/client";
import {
  ema,
  highestHigh,
  lowestLow,
  macd,
  roc,
  rollingStd,
  rsi,
  sma,
} from "@/lib/strategies/indicators";
import { dcaEveryMs } from "@/lib/bot/decisions";
import { INTERVAL_MS } from "@/lib/intervals";
import { defaultParams, getStrategy, signalWindow } from "@/lib/strategies";
import type { BotConfig } from "./executor";

// "Qué está mirando el robot ahora": traduce el estado actual del indicador
// de cada estrategia a una frase entendible. Solo lectura, con velas cacheadas.

const usd = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

export async function getBotInsight(bot: BotConfig): Promise<string | null> {
  try {
    const strategy = getStrategy(bot.strategyId);
    if (!strategy) return null;
    const params = {
      ...defaultParams(strategy),
      ...(bot.params as Record<string, number>),
    };
    // La MISMA ventana canónica con la que evalSignal decide (y el intervalo
    // de la estrategia): los valores mostrados son exactamente los que el
    // robot está mirando.
    const candles = await getKlines(
      bot.symbol,
      strategy.intervalo,
      Math.min(1000, signalWindow(strategy, params) + 1)
    );
    const closed = candles.slice(0, -1);
    const i = closed.length - 1;
    if (i < strategy.warmup(params)) return null;
    const closes = closed.map((c) => c.close);
    const price = closes[i];

    switch (strategy.id) {
      case "rsi-reversion": {
        const value = rsi(closes, Math.round(params.periodo))[i];
        if (value === null) return null;
        return `El RSI está en ${num.format(value)}. El robot compra si baja de ${params.umbralCompra} y vende si supera ${params.umbralVenta}.`;
      }
      case "sma-cross": {
        const short = sma(closes, Math.round(params.corta))[i];
        const long = sma(closes, Math.round(params.larga))[i];
        if (short === null || long === null) return null;
        const arriba = short > long;
        return `Media corta: ${usd.format(short)} · media larga: ${usd.format(long)}. La corta está ${arriba ? "POR ENCIMA (tendencia alcista)" : "por debajo — esperando el cruce alcista"}.`;
      }
      case "macd-ola": {
        const { line, signal } = macd(
          closes,
          Math.round(params.rapida),
          Math.round(params.lenta),
          Math.round(params.senal)
        );
        const l = line[i];
        const s = signal[i];
        if (l === null || s === null) return null;
        const filtro = Math.round(params.filtroEma);
        let tendencia = "";
        if (filtro > 0) {
          const trend = ema(closes, filtro)[i];
          if (trend !== null) {
            tendencia = ` Precio ${price > trend ? "sobre" : "bajo"} la EMA${filtro} (${price > trend ? "habilitado para comprar" : "compras bloqueadas"}).`;
          }
        }
        return `El envión (MACD) está ${l > s ? "positivo — arriba de su señal" : "negativo — esperando el cruce alcista"}.${tendencia}`;
      }
      case "bollinger-rebote": {
        const period = Math.round(params.periodo);
        const mid = sma(closes, period)[i];
        const std = rollingStd(closes, period)[i];
        if (mid === null || std === null) return null;
        const lower = mid - params.desvios * std;
        return `Precio: ${usd.format(price)} · banda inferior: ${usd.format(lower)} · zona normal: ${usd.format(mid)}. Compra en el rebote tras perforar la banda inferior.`;
      }
      case "donchian-techos": {
        const hh = highestHigh(closed, Math.round(params.ventanaEntrada), i);
        const ll = lowestLow(closed, Math.round(params.ventanaSalida), i);
        if (hh === null || ll === null) return null;
        return `Precio: ${usd.format(price)}. Techo a romper para comprar: ${usd.format(hh)} · piso de salida: ${usd.format(ll)}.`;
      }
      case "roc-envion": {
        const value = roc(closes, Math.round(params.ventana))[i];
        if (value === null) return null;
        return `En los últimos ${Math.round(params.ventana)} días el precio se movió ${num.format(value)}%. Entra si supera +${params.umbralEntrada}% y sale si baja de ${params.umbralSalida}%.`;
      }
      case "pullback-recorte": {
        const trend = ema(closes, Math.round(params.emaTendencia))[i];
        const value = rsi(closes, Math.round(params.periodoRsi))[i];
        if (trend === null || value === null) return null;
        return `Tendencia de fondo: ${price > trend ? "ALCISTA (habilitado)" : "bajista — el robot espera afuera"} · RSI: ${num.format(value)} (compra cuando recupera ${params.rsiEntrada}).`;
      }
      case "dca": {
        const everyMs = dcaEveryMs(
          INTERVAL_MS[strategy.intervalo],
          params.cadaNVelas
        );
        const next = bot.lastBuyAt
          ? new Date(bot.lastBuyAt.getTime() + everyMs)
          : new Date();
        const cuando = next <= new Date()
          ? "en la próxima revisión"
          : new Intl.DateTimeFormat("es-AR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Argentina/Buenos_Aires",
            }).format(next);
        const restante = bot.budgetUsdt - bot.investedUsdt;
        return `Próxima compra: ${cuando}. Presupuesto restante: ${usd.format(Math.max(0, restante))}.`;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
