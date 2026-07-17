import { createHmac } from "node:crypto";
import type { KlineInterval } from "@/lib/intervals";
import type { Candle } from "../strategies/types";

// Datos de cuenta (saldos, órdenes): testnet o producción según .env.
// Datos de mercado (precios): SIEMPRE del endpoint público oficial de datos,
// sin API key — así el testnet se valúa a precios reales.
const MARKET_DATA_BASE = "https://data-api.binance.vision";

// Testnet salvo opt-out explícito: la API real solo se toca si alguien
// escribió BINANCE_USE_TESTNET=false a conciencia.
export function isTestnet(): boolean {
  return process.env.BINANCE_USE_TESTNET !== "false";
}

function accountBase(): string {
  return isTestnet()
    ? "https://testnet.binance.vision"
    : "https://api.binance.com";
}

export class BinanceApiError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(status: number, code: number, message: string) {
    super(message);
    this.name = "BinanceApiError";
    this.status = status;
    this.code = code;
  }

  // Mensajes para usuarios no técnicos, mapeados de los códigos de Binance.
  get friendlyMessage(): string {
    switch (this.code) {
      case -2014:
      case -2015:
        return "Binance rechazó la clave. Puede estar mal copiada, ser del entorno equivocado (práctica vs. real) o no tener los permisos necesarios — para que el robot opere, la clave necesita «trading de spot» habilitado.";
      case -1022:
        return "La clave secreta no coincide con la API Key. Volvé a copiar ambas desde Binance.";
      case -1021:
        return "El reloj del servidor quedó desincronizado con Binance. Probá de nuevo en unos segundos.";
      case -2010:
        // El caso típico en la práctica: la suscripción automática de
        // Binance Earn barre los USDT de la billetera Spot y la orden
        // MARKET falla por saldo insuficiente aunque la plata "esté".
        return /insufficient balance/i.test(this.message)
          ? "Binance no encontró saldo disponible en tu billetera Spot. Ojo: si tenés activada la suscripción automática de Binance Earn, tus USDT se mueven solos a Earn y el robot no puede usarlos. Entrá a Binance, rescatá los fondos de Earn a tu billetera Spot y desactivá la suscripción automática."
          : `Binance rechazó la orden (${this.code}): ${this.message}`;
      default:
        return `Binance devolvió un error (${this.code}): ${this.message}`;
    }
  }
}

// Falla de RED (el "fetch failed" crudo de Node): DNS caído, socket cortado,
// timeout. Binance nunca llegó a responder — no es un rechazo de la API, y al
// usuario no le pide ninguna acción: la próxima revisión reintenta sola.
export const CONNECTION_ERROR_MESSAGE =
  "No hubo conexión con Binance en la última revisión (corte momentáneo de internet o del servidor). No tenés que hacer nada: el robot reintenta solo en la próxima revisión.";

export function isConnectionError(error: unknown): boolean {
  if (error instanceof BinanceApiError || !(error instanceof Error)) {
    return false;
  }
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return /fetch failed|terminated|socket|network|ECONN|ETIMEDOUT|EAI_AGAIN|abort/i.test(
    `${error.message} ${cause}`
  );
}

async function parseError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as {
    code?: number;
    msg?: string;
  } | null;
  throw new BinanceApiError(
    res.status,
    body?.code ?? -1,
    body?.msg ?? res.statusText
  );
}

async function signedFetch<T>(
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string> = {},
  method: "GET" | "POST" | "DELETE" = "GET"
): Promise<T> {
  const query = new URLSearchParams({
    ...params,
    recvWindow: "10000",
    timestamp: Date.now().toString(),
  });
  const signature = createHmac("sha256", apiSecret)
    .update(query.toString())
    .digest("hex");
  query.append("signature", signature);

  const res = await fetch(`${accountBase()}${path}?${query.toString()}`, {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });
  if (!res.ok) await parseError(res);
  return res.json() as Promise<T>;
}

// Permite saber si la API key tiene habilitado el retiro. El endpoint SAPI
// solo existe en el mainnet; en testnet devolvemos null (las keys del testnet
// no pueden mover fondos reales, así que no hace falta rechazarlas).
export async function apiKeyAllowsWithdrawal(
  apiKey: string,
  apiSecret: string
): Promise<boolean | null> {
  if (isTestnet()) return null;
  try {
    const res = await signedFetch<{ enableWithdrawals?: boolean }>(
      "/sapi/v1/account/apiRestrictions",
      apiKey,
      apiSecret
    );
    return res.enableWithdrawals === true;
  } catch {
    // Si el endpoint no responde, no bloqueamos la conexión por eso.
    return null;
  }
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

interface RawAccount {
  balances: { asset: string; free: string; locked: string }[];
  // Fracciones (0.001 = 0,1%). Binance las devuelve en /account desde 2022.
  commissionRates?: { maker: string; taker: string };
}

// Valida las credenciales y devuelve los saldos con tenencia > 0.
export async function getAccountBalances(
  apiKey: string,
  apiSecret: string
): Promise<Balance[]> {
  const account = await signedFetch<RawAccount>(
    "/api/v3/account",
    apiKey,
    apiSecret,
    { omitZeroBalances: "true" }
  );
  return account.balances
    .map((b) => {
      const free = Number(b.free);
      const locked = Number(b.locked);
      return { asset: b.asset, free, locked, total: free + locked };
    })
    .filter((b) => b.total > 0);
}

// Comisión taker REAL de la cuenta, en porcentaje (0.1 = 0,1%). Las órdenes
// MARKET del robot son siempre taker. null si Binance no la informa.
export async function getTakerFeePct(
  apiKey: string,
  apiSecret: string
): Promise<number | null> {
  const account = await signedFetch<RawAccount>(
    "/api/v3/account",
    apiKey,
    apiSecret,
    { omitZeroBalances: "true" }
  );
  const taker = Number(account.commissionRates?.taker);
  return Number.isFinite(taker) && taker > 0 ? taker * 100 : null;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
}

interface RawTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

function toTicker(raw: RawTicker): Ticker {
  return {
    symbol: raw.symbol,
    lastPrice: Number(raw.lastPrice),
    priceChangePercent: Number(raw.priceChangePercent),
  };
}

export type { KlineInterval } from "@/lib/intervals";

// Precio spot al instante (sin caché): lo usa el chequeo de stops del robot.
export async function getSpotPrice(symbol: string): Promise<number | null> {
  const res = await fetch(
    `${MARKET_DATA_BASE}/api/v3/ticker/price?symbol=${symbol}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { price?: string };
  const price = Number(body.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

type RawKline = [
  number, // openTime
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // closeTime
  ...unknown[],
];

// Velas históricas desde el endpoint público de datos (máx. 1000 por pedido).
// `endTime` (opcional) devuelve las velas que TERMINAN hasta ese momento —
// lo usa getKlinesPaged para paginar hacia atrás.
export async function getKlines(
  symbol: string,
  interval: KlineInterval,
  limit: number,
  endTime?: number
): Promise<Candle[]> {
  const url = `${MARKET_DATA_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(
    limit,
    1000
  )}${endTime !== undefined ? `&endTime=${endTime}` : ""}`;
  // 60s de caché: las decisiones se toman sobre velas CERRADAS, así que la
  // única consecuencia es enterarse de una vela nueva hasta 1 min más tarde.
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) await parseError(res);
  const raw = (await res.json()) as RawKline[];
  return raw.map((k) => ({
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: k[6],
  }));
}

// Historia larga (backtests): encadena pedidos de a 1000 hacia atrás hasta
// juntar `total` velas o agotar la historia del par. Devuelve en orden
// cronológico; la última vela puede venir en formación (el que consume
// decide descartarla). `fetchPage` es inyectable para testear la paginación
// sin red.
export async function getKlinesPaged(
  symbol: string,
  interval: KlineInterval,
  total: number,
  fetchPage: (
    symbol: string,
    interval: KlineInterval,
    limit: number,
    endTime?: number
  ) => Promise<Candle[]> = getKlines
): Promise<Candle[]> {
  const out: Candle[] = [];
  let endTime: number | undefined;
  while (out.length < total) {
    const want = Math.min(1000, total - out.length);
    const batch = await fetchPage(symbol, interval, want, endTime);
    if (batch.length === 0) break;
    out.unshift(...batch);
    if (batch.length < want) break; // historia agotada
    endTime = batch[0].openTime - 1;
  }
  return out;
}

// Filtros de trading de un símbolo (tamaño mínimo de orden, redondeo de
// cantidades). Necesarios para que Binance no rechace las órdenes del bot.
export interface SymbolFilters {
  stepSize: number;
  minQty: number;
  minNotional: number;
}

interface RawExchangeInfo {
  symbols: {
    symbol: string;
    filters: {
      filterType: string;
      stepSize?: string;
      minQty?: string;
      minNotional?: string;
    }[];
  }[];
}

export async function getSymbolFilters(
  symbol: string
): Promise<SymbolFilters> {
  const res = await fetch(
    `${accountBase()}/api/v3/exchangeInfo?symbol=${symbol}`,
    { cache: "no-store" }
  );
  if (!res.ok) await parseError(res);
  const info = (await res.json()) as RawExchangeInfo;
  const filters = info.symbols[0]?.filters ?? [];
  const lot = filters.find((f) => f.filterType === "LOT_SIZE");
  const notional = filters.find((f) => f.filterType === "NOTIONAL");
  return {
    stepSize: Number(lot?.stepSize ?? 0.00001),
    minQty: Number(lot?.minQty ?? 0),
    minNotional: Number(notional?.minNotional ?? 10),
  };
}

// Redondea una cantidad hacia abajo al múltiplo del stepSize del símbolo.
export function roundToStep(qty: number, stepSize: number): number {
  if (stepSize <= 0) return qty;
  const steps = Math.floor(qty / stepSize + 1e-9);
  return Number((steps * stepSize).toFixed(8));
}

export interface OrderResult {
  orderId: number;
  executedQty: number; // cantidad bruta operada
  cummulativeQuoteQty: number; // total bruto en USDT
  avgPrice: number;
  // Cantidades NETAS tras descontar comisiones (Binance las cobra del activo
  // recibido, salvo que se paguen con BNB). El robot contabiliza SIEMPRE
  // con estas: registrar el bruto sobreestima la posición ~0,1% y una venta
  // de "todo" puede rebotar por saldo insuficiente.
  netBaseQty: number;
  netQuoteQty: number;
}

export interface OrderFill {
  commission: string;
  commissionAsset: string;
}

interface RawOrder {
  orderId: number;
  executedQty: string;
  cummulativeQuoteQty: string;
  fills?: OrderFill[];
}

// Suma de comisiones cobradas en un activo específico.
export function commissionIn(fills: OrderFill[], asset: string): number {
  return fills
    .filter((f) => f.commissionAsset === asset)
    .reduce((sum, f) => sum + Number(f.commission), 0);
}

// Orden MARKET. Guarda de seguridad: contra la API real solo opera si
// ALLOW_REAL_TRADING=true fue seteado a conciencia en el .env.
export async function placeMarketOrder(
  apiKey: string,
  apiSecret: string,
  opts: {
    symbol: string;
    side: "BUY" | "SELL";
    quoteOrderQty?: number; // comprar por monto en USDT
    quantity?: number; // vender una cantidad del activo
  }
): Promise<OrderResult> {
  if (!isTestnet() && process.env.ALLOW_REAL_TRADING !== "true") {
    throw new Error(
      "Trading con dinero real deshabilitado: seteá ALLOW_REAL_TRADING=true en .env solo cuando hayas validado todo en el testnet."
    );
  }

  const params: Record<string, string> = {
    symbol: opts.symbol,
    side: opts.side,
    type: "MARKET",
  };
  if (opts.quoteOrderQty !== undefined) {
    params.quoteOrderQty = opts.quoteOrderQty.toFixed(2);
  } else if (opts.quantity !== undefined) {
    params.quantity = String(opts.quantity);
  } else {
    throw new Error("La orden necesita quoteOrderQty o quantity.");
  }

  const raw = await signedFetch<RawOrder>(
    "/api/v3/order",
    apiKey,
    apiSecret,
    params,
    "POST"
  );
  const executedQty = Number(raw.executedQty);
  const cummulativeQuoteQty = Number(raw.cummulativeQuoteQty);

  // Nuestros pares son siempre XXXUSDT.
  const baseAsset = opts.symbol.replace(/USDT$/, "");
  const fills = raw.fills ?? [];
  const netBaseQty = executedQty - commissionIn(fills, baseAsset);
  const netQuoteQty = cummulativeQuoteQty - commissionIn(fills, "USDT");

  return {
    orderId: raw.orderId,
    executedQty,
    cummulativeQuoteQty,
    avgPrice: executedQty > 0 ? cummulativeQuoteQty / executedQty : 0,
    netBaseQty,
    netQuoteQty,
  };
}

// Precios + variación 24h para una lista de símbolos (p. ej. ["BTCUSDT"]).
// Si el lote falla (basta un símbolo inexistente para que Binance rechace
// todo), reintenta de a uno y descarta solo los que no existen.
export async function get24hTickers(
  symbols: string[]
): Promise<Map<string, Ticker>> {
  const result = new Map<string, Ticker>();
  if (symbols.length === 0) return result;

  const batchUrl = `${MARKET_DATA_BASE}/api/v3/ticker/24hr?symbols=${encodeURIComponent(
    JSON.stringify(symbols)
  )}`;
  // Precios compartidos entre usuarios: 20s de caché alivian mucho la carga.
  const res = await fetch(batchUrl, { next: { revalidate: 20 } });

  if (res.ok) {
    for (const raw of (await res.json()) as RawTicker[]) {
      result.set(raw.symbol, toTicker(raw));
    }
    return result;
  }

  const individual = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const r = await fetch(
        `${MARKET_DATA_BASE}/api/v3/ticker/24hr?symbol=${symbol}`,
        { next: { revalidate: 20 } }
      );
      if (!r.ok) await parseError(r);
      return toTicker((await r.json()) as RawTicker);
    })
  );
  for (const settled of individual) {
    if (settled.status === "fulfilled") {
      result.set(settled.value.symbol, settled.value);
    }
  }
  return result;
}
