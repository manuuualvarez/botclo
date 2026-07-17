import { getKlines } from "@/lib/binance/client";
import {
  BUY_GRACE_CANDLES,
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
import {
  defaultParams,
  evalSignal,
  getStrategy,
  signalWindow,
} from "@/lib/strategies";
import type { BotConfig } from "./executor";

// "Qué está mirando el robot ahora": traduce el estado actual del indicador
// de cada estrategia a una frase entendible. Solo lectura, con velas cacheadas.
// La frase SIEMPRE distingue entre "hay señal vigente" y "la señal ya pasó":
// decir "habilitado para comprar" cuando el cruce quedó atrás hacía que el
// robot pareciera roto por no comprar.

const usd = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

// Valores del MACD: son diferencias de precio (minúsculas en pares baratos) —
// cifras significativas para que nunca se muestren como "0".
const val = new Intl.NumberFormat("es-AR", { maximumSignificantDigits: 4 });

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

    const signal =
      strategy.modo === "dca" ? "hold" : evalSignal(strategy, closed, i, params);
    const hasPosition = bot.positionQty * price >= 5;

    // Cierre accionable, común a todas las estrategias: qué significa la
    // señal de HOY para este robot — y qué hacer si está pausado.
    const yaProceso = bot.lastCandleTime === closed[i].openTime;
    let estado = "";
    if (signal === "buy" && !hasPosition) {
      estado =
        bot.status === "paused"
          ? " 🟢 Hay señal de COMPRA vigente, pero el robot está pausado: reanudalo si querés que entre."
          : yaProceso
            ? " 🟢 Hay señal de compra vigente."
            : " 🟢 Señal de compra vigente: el robot la toma en su próxima revisión.";
    } else if (signal === "sell" && hasPosition) {
      estado =
        bot.status === "paused"
          ? " 🔴 Hay señal de VENTA vigente, pero el robot está pausado: reanudalo para que gestione la salida."
          : " 🔴 Señal de venta vigente: el robot la toma en su próxima revisión.";
    }

    let texto: string | null = null;
    switch (strategy.id) {
      case "rsi-reversion": {
        const value = rsi(closes, Math.round(params.periodo))[i];
        if (value === null) return null;
        texto = `El RSI está en ${num.format(value)}. El robot compra si baja de ${params.umbralCompra} y vende si supera ${params.umbralVenta}.`;
        break;
      }
      case "sma-cross": {
        const short = sma(closes, Math.round(params.corta))[i];
        const long = sma(closes, Math.round(params.larga))[i];
        if (short === null || long === null) return null;
        const medias = `Media corta: ${usd.format(short)} · media larga: ${usd.format(long)}.`;
        if (short <= long) {
          texto = `${medias} La corta está por debajo — esperando el cruce alcista.`;
        } else if (hasPosition) {
          texto = `${medias} La corta está POR ENCIMA (tendencia alcista): el robot mantiene la posición hasta el cruce bajista.`;
        } else if (signal === "buy") {
          texto = `${medias} La corta acaba de cruzar por encima de la larga.`;
        } else {
          texto = `${medias} La corta está por encima, pero el cruce ya pasó hace más de ${BUY_GRACE_CANDLES} velas sin que el robot pudiera comprar: espera el próximo cruce alcista.`;
        }
        break;
      }
      case "macd-ola": {
        const { line, signal: sig } = macd(
          closes,
          Math.round(params.rapida),
          Math.round(params.lenta),
          Math.round(params.senal)
        );
        const l = line[i];
        const s = sig[i];
        if (l === null || s === null) return null;
        const filtro = Math.round(params.filtroEma);
        const trend = filtro > 0 ? ema(closes, filtro)[i] : null;
        const filtroOk = filtro <= 0 || (trend !== null && price > trend);
        // Los números exactos que el robot comparó: sin esto, "espera el
        // cruce" no dice ni qué precio evaluó ni cuánto le falta al envión.
        const numeros = `Precio evaluado: ${usd.format(price)} · envión (MACD): ${val.format(l)} / señal a cruzar: ${val.format(s)}${
          filtro > 0 && trend !== null ? ` · EMA${filtro}: ${usd.format(trend)}` : ""
        }.`;
        if (l < s) {
          texto = hasPosition
            ? `${numeros} El envión cruzó por debajo de su señal.`
            : `${numeros} El envión está por debajo de su señal — el robot compra recién cuando la cruce para arriba${filtro > 0 ? ` con el precio sobre la EMA${filtro}` : ""}.`;
        } else if (hasPosition) {
          texto = `${numeros} El envión sigue arriba de su señal: el robot mantiene la posición y vende cuando cruce para abajo.`;
        } else if (signal === "buy") {
          texto = `${numeros} El envión acaba de cruzar para arriba con el mercado a favor.`;
        } else if (!filtroOk) {
          texto = `${numeros} El envión es positivo, pero el precio está debajo de la EMA${filtro}: las compras quedan bloqueadas hasta que el mercado vuelva a ser alcista.`;
        } else {
          texto = `${numeros} El envión es positivo, pero el cruce alcista ya pasó hace más de ${BUY_GRACE_CANDLES} velas sin que el robot pudiera comprarlo: ahora espera que afloje y vuelva a cruzar para arriba.`;
        }
        break;
      }
      case "bollinger-rebote": {
        const period = Math.round(params.periodo);
        const mid = sma(closes, period)[i];
        const std = rollingStd(closes, period)[i];
        if (mid === null || std === null) return null;
        const lower = mid - params.desvios * std;
        const bandas = `Precio: ${usd.format(price)} · banda inferior: ${usd.format(lower)} · zona normal: ${usd.format(mid)}.`;
        if (hasPosition) {
          texto = `${bandas} El robot vende cuando el precio vuelva a la zona normal.`;
        } else if (signal === "buy") {
          texto = `${bandas} El precio perforó la banda inferior y está rebotando.`;
        } else {
          texto = `${bandas} Espera una caída exagerada (perforar la banda inferior) para comprar el rebote confirmado.`;
        }
        break;
      }
      case "donchian-techos": {
        const hh = highestHigh(closed, Math.round(params.ventanaEntrada), i);
        const ll = lowestLow(closed, Math.round(params.ventanaSalida), i);
        if (hh === null || ll === null) return null;
        texto = `Precio: ${usd.format(price)}. Techo a romper para comprar: ${usd.format(hh)} · piso de salida: ${usd.format(ll)}.`;
        break;
      }
      case "roc-envion": {
        const value = roc(closes, Math.round(params.ventana))[i];
        if (value === null) return null;
        texto = `En los últimos ${Math.round(params.ventana)} días el precio se movió ${num.format(value)}%. Entra si supera +${params.umbralEntrada}% y sale si baja de ${params.umbralSalida}%.`;
        break;
      }
      case "pullback-recorte": {
        const trend = ema(closes, Math.round(params.emaTendencia))[i];
        const value = rsi(closes, Math.round(params.periodoRsi))[i];
        if (trend === null || value === null) return null;
        if (price < trend) {
          texto = `Tendencia de fondo: bajista — el robot espera afuera hasta que el precio supere su promedio de largo plazo.`;
        } else if (hasPosition) {
          texto = `Tendencia alcista · RSI: ${num.format(value)}. El robot vende cuando el RSI supere ${params.rsiSalida} o la tendencia se dé vuelta.`;
        } else if (signal === "buy") {
          texto = `Tendencia alcista · RSI: ${num.format(value)}. El recorte acaba de recuperarse.`;
        } else if (value >= params.rsiEntrada) {
          texto = `Tendencia alcista · RSI: ${num.format(value)}. La última recuperación ya pasó sin que el robot pudiera comprar: espera un recorte nuevo (RSI abajo de ${params.rsiEntrada}) para la próxima entrada.`;
        } else {
          texto = `Tendencia alcista · RSI: ${num.format(value)} (en recorte). El robot compra cuando el RSI recupere ${params.rsiEntrada}.`;
        }
        break;
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
    return texto === null ? null : texto + estado;
  } catch {
    return null;
  }
}
