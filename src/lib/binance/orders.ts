import { createHmac } from "node:crypto";
import { compare, floorToStep, multiply, normalize } from "./decimal";

export type BinanceEnvironment = "testnet" | "mainnet";
export interface ExchangeOrder {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  status: string;
  side: "BUY" | "SELL";
  type: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  stopPrice?: string;
  updateTime: number;
}
export interface ExchangeFill {
  id: string;
  orderId: string;
  symbol: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
}
export interface NewExchangeOrder {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "STOP_LOSS";
  clientOrderId: string;
  quantity?: string;
  quoteOrderQty?: string;
  stopPrice?: string;
}
export interface ExchangeAccount {
  uid: string;
  canTrade?: boolean;
  balances: { asset: string; free: string; locked: string }[];
}
interface LotSize { minQty: string; maxQty: string; stepSize: string }
export interface ExchangeRules extends LotSize {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  quoteAssetPrecision: number;
  orderTypes: string[];
  cancelReplaceAllowed: boolean;
  minPrice: string;
  maxPrice: string;
  tickSize: string;
  minNotional: string;
  maxNotional: string;
  applyMinToMarket: boolean;
  applyMaxToMarket: boolean;
  avgPriceMins: number;
  marketLotSize?: LotSize;
}
interface ExchangeRejection { code: number; message: string }
export interface CancelReplaceResult {
  cancelResult: "SUCCESS" | "FAILURE";
  newOrderResult: "SUCCESS" | "FAILURE" | "NOT_ATTEMPTED";
  canceledOrder?: ExchangeOrder;
  newOrder?: ExchangeOrder;
  cancelError?: ExchangeRejection;
  newOrderError?: ExchangeRejection;
}

// Los mensajes remotos pueden incluir datos de la petición. Solo exponemos
// códigos y mensajes propios; ni URLs firmadas, ni body, ni causas de fetch.
export class BinanceOrderError extends Error {
  constructor(
    readonly code: number,
    readonly status: number,
    message = `Binance rechazó la solicitud (código ${code}).`,
    readonly retryAfterMs = 0,
  ) { super(message); this.name = "BinanceOrderError"; }
}
export class UnknownExecutionError extends Error {
  constructor(readonly code?: number, readonly status?: number) {
    super("No se pudo confirmar el resultado en Binance. Conciliá la orden antes de volver a operar.");
    this.name = "UnknownExecutionError";
  }
}

const HOSTS: Record<BinanceEnvironment, string> = {
  testnet: "https://testnet.binance.vision",
  mainnet: "https://api.binance.com",
};
const PAGE_SIZE = 1000;
const MAX_PAGES = 10000;
const DAY = 86_400_000;
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Respuesta Binance inválida.");
  return value as ObjectValue;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Campo Binance inválido.");
  return value;
}
function integer(value: unknown): number {
  const parsed = Number(text(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Entero Binance inválido.");
  return parsed;
}
function identifier(value: unknown): string {
  const result = text(value);
  if (!/^\d+$/.test(result)) throw new Error("Identificador Binance inválido.");
  return BigInt(result).toString();
}
function decimal(value: unknown): string { return normalize(text(value)); }
function nonnegative(value: unknown): string {
  const result = decimal(value);
  if (compare(result, "0") < 0) throw new Error("Cantidad Binance inválida.");
  return result;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Lista Binance inválida.");
  return value;
}
function symbol(value: string): string {
  if (!/^[A-Z0-9]{2,30}$/.test(value)) throw new BinanceOrderError(-1, 0, "Símbolo inválido.");
  return value;
}
function clientId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,36}$/.test(value)) throw new BinanceOrderError(-1, 0, "Identificador de intención inválido.");
  return value;
}
function rejection(value: unknown): ExchangeRejection {
  const code = Number(object(value).code);
  if (!Number.isSafeInteger(code)) throw new Error("Rechazo Binance inválido.");
  return { code, message: `Binance rechazó la solicitud (código ${code}).` };
}

// Tokenizamos números fuera de strings ANTES de JSON.parse: el reviver llega
// demasiado tarde para IDs int64. Los strings (incluidos escapes) se preservan.
function parseExactJSON(source: string): unknown {
  // Validar primero la gramática original evita aceptar, por ejemplo, 0123.
  // El resultado de esta primera pasada se descarta: no se leen sus números.
  JSON.parse(source);
  const tokens = source.replace(/"(?:\\[\s\S]|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (token, number: string | undefined) => number === undefined ? token : `"${number}"`);
  return JSON.parse(tokens) as unknown;
}

function order(value: unknown, expectedSymbol: string): ExchangeOrder {
  const row = object(value);
  if (row.symbol !== expectedSymbol || (row.side !== "BUY" && row.side !== "SELL")) throw new Error("Orden Binance incompatible.");
  return {
    symbol: expectedSymbol, orderId: identifier(row.orderId),
    clientOrderId: text(row.origClientOrderId ?? row.clientOrderId), status: text(row.status), side: row.side,
    type: text(row.type), origQty: nonnegative(row.origQty), executedQty: nonnegative(row.executedQty),
    // Binance devuelve -1 si el acumulado histórico no está disponible. El
    // reconciliador exige fills completos: no inventar un importe en cero.
    cummulativeQuoteQty: decimal(row.cummulativeQuoteQty),
    ...(row.stopPrice === undefined ? {} : { stopPrice: nonnegative(row.stopPrice) }),
    updateTime: integer(row.updateTime ?? row.transactTime ?? row.time),
  };
}
function fill(value: unknown, expectedSymbol: string, expectedOrderId: string): ExchangeFill {
  const row = object(value);
  if (row.symbol !== expectedSymbol || identifier(row.orderId) !== expectedOrderId) throw new Error("Fill Binance incompatible.");
  return {
    id: identifier(row.id), orderId: expectedOrderId, symbol: expectedSymbol,
    price: nonnegative(row.price), qty: nonnegative(row.qty), quoteQty: nonnegative(row.quoteQty),
    commission: nonnegative(row.commission), commissionAsset: text(row.commissionAsset), time: integer(row.time),
  };
}

function checkRange(value: string, minimum: string, maximum: string, label: string) {
  if (compare(value, minimum) < 0 || (compare(maximum, "0") > 0 && compare(value, maximum) > 0)) {
    throw new BinanceOrderError(-1013, 0, `${label} fuera de los límites del símbolo.`);
  }
}
function checkStep(value: string, increment: string, label: string) {
  if (compare(increment, "0") > 0 && compare(value, floorToStep(value, increment)) !== 0) {
    throw new BinanceOrderError(-1013, 0, `${label} no respeta el paso del símbolo.`);
  }
}
function positive(value: string): string {
  const normalized = normalize(value);
  if (compare(normalized, "0") <= 0) throw new BinanceOrderError(-1013, 0, "La cantidad o el precio debe ser positivo.");
  return normalized;
}

export class BinanceOrderClient {
  readonly environment: BinanceEnvironment;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private retryNotBefore = 0;

  constructor(options: { apiKey: string; apiSecret: string; environment: BinanceEnvironment; fetch?: typeof fetch; now?: () => number }) {
    if (options.environment !== "testnet" && options.environment !== "mainnet") throw new Error("Entorno Binance inválido.");
    this.environment = options.environment;
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private mutationAllowed() {
    if (this.environment === "mainnet" && process.env.ALLOW_REAL_TRADING !== "true") {
      throw new BinanceOrderError(-1, 0, "Trading con dinero real deshabilitado.");
    }
  }

  private async request(path: string, parameters: Record<string, string>, method: "GET" | "POST" = "GET", signed = true, partial = false): Promise<unknown> {
    if (method !== "GET") this.mutationAllowed();
    const now = this.now();
    if (this.retryNotBefore > now) {
      throw new BinanceOrderError(-1003, 429, "Binance pidió esperar antes de otra solicitud.", this.retryNotBefore - now);
    }
    const params = new URLSearchParams(parameters);
    const headers = new Headers();
    if (signed) {
      params.set("recvWindow", "10000"); params.set("timestamp", String(now));
      params.set("signature", createHmac("sha256", this.apiSecret).update(params.toString()).digest("hex"));
      headers.set("X-MBX-APIKEY", this.apiKey);
    }
    if (method === "POST") headers.set("Content-Type", "application/x-www-form-urlencoded");
    let response: Response;
    try {
      response = await this.fetcher(`${HOSTS[this.environment]}${path}${method === "GET" ? `?${params}` : ""}`, {
        method, headers, ...(method === "POST" ? { body: params.toString() } : {}),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new UnknownExecutionError(); }
    const retryHeader = response.headers.get("Retry-After");
    const retryAfterMs = retryHeader === null ? 0 : /^\d+(?:\.\d+)?$/.test(retryHeader)
      ? Math.ceil(Number(retryHeader) * 1000) : Math.max(0, Date.parse(retryHeader) - now);
    if (response.status === 429 || response.status === 418) {
      this.retryNotBefore = now + (Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 60_000);
    }
    let body: unknown;
    try { body = parseExactJSON(await response.text()); } catch {
      if (response.status === 429 || response.status === 418) {
        throw new BinanceOrderError(-1003, response.status, "Binance pidió esperar antes de otra solicitud.", this.retryNotBefore - now);
      }
      throw new UnknownExecutionError(undefined, response.status);
    }
    const record = typeof body === "object" && body !== null && !Array.isArray(body) ? body as ObjectValue : {};
    const code = Number(record.code ?? 0);
    if (response.status >= 500 || code === -1007 || code === -1006) throw new UnknownExecutionError(code, response.status);
    // cancelReplace puede devolver un body útil dentro de data en HTTP 400,
    // 409 o 429. Nunca descartarlo como un simple error de transporte.
    const candidate = record.data ?? record;
    if (partial && typeof candidate === "object" && candidate !== null && "cancelResult" in candidate) return candidate;
    if (!response.ok || code < 0) {
      throw new BinanceOrderError(Number.isSafeInteger(code) ? code : -1, response.status, undefined,
        this.retryNotBefore > now ? this.retryNotBefore - now : 0);
    }
    return body;
  }

  async getAccount(): Promise<ExchangeAccount> {
    const row = object(await this.request("/api/v3/account", { omitZeroBalances: "true" }));
    return { uid: identifier(row.uid), ...(typeof row.canTrade === "boolean" ? { canTrade: row.canTrade } : {}),
      balances: array(row.balances).map(value => {
        const balance = object(value);
        return { asset: text(balance.asset), free: nonnegative(balance.free), locked: nonnegative(balance.locked) };
      }) };
  }

  async getLastPrice(pair: string): Promise<string> {
    const row = object(await this.request("/api/v3/ticker/price", { symbol: symbol(pair) }, "GET", false));
    if (row.symbol !== pair) throw new Error("El precio no corresponde al símbolo solicitado.");
    return positive(text(row.price));
  }

  async getRules(pair: string): Promise<ExchangeRules> {
    const result = object(await this.request("/api/v3/exchangeInfo", { symbol: symbol(pair) }, "GET", false));
    const row = array(result.symbols).map(object).find(value => value.symbol === pair);
    if (!row) throw new BinanceOrderError(-1121, 0, "Binance no devolvió reglas para ese símbolo.");
    const filters = array(row.filters).map(object);
    const required = (type: string) => {
      const filter = filters.find(value => value.filterType === type);
      if (!filter) throw new BinanceOrderError(-1013, 0, "Faltan filtros necesarios para operar el símbolo.");
      return filter;
    };
    const price = required("PRICE_FILTER"); const lot = required("LOT_SIZE");
    const notional = filters.find(value => value.filterType === "NOTIONAL");
    const minNotional = filters.find(value => value.filterType === "MIN_NOTIONAL");
    if (!notional && !minNotional) throw new BinanceOrderError(-1013, 0, "Falta el filtro de notional del símbolo.");
    const marketLot = filters.find(value => value.filterType === "MARKET_LOT_SIZE");
    const asLot = (value: ObjectValue): LotSize => ({ minQty: nonnegative(value.minQty), maxQty: nonnegative(value.maxQty), stepSize: nonnegative(value.stepSize) });
    // Cuando ambos filtros existen, Binance aplica ambos. Si sus ventanas
    // difieren, bloquear antes de estimar un notional con precio equivocado.
    if (notional && minNotional && integer(notional.avgPriceMins) !== integer(minNotional.avgPriceMins)) {
      throw new BinanceOrderError(-1013, 0, "Los filtros de notional requieren ventanas de precio diferentes.");
    }
    const minima = [notional, minNotional].filter((v): v is ObjectValue => v !== undefined).map(value => nonnegative(value.minNotional));
    const minimum = minima.reduce((a, b) => compare(a, b) >= 0 ? a : b);
    return { symbol: pair, status: text(row.status), baseAsset: text(row.baseAsset), quoteAsset: text(row.quoteAsset),
      quoteAssetPrecision: integer(row.quoteAssetPrecision), orderTypes: array(row.orderTypes).map(text),
      cancelReplaceAllowed: row.cancelReplaceAllowed === true,
      ...asLot(lot), minPrice: nonnegative(price.minPrice), maxPrice: nonnegative(price.maxPrice), tickSize: nonnegative(price.tickSize),
      minNotional: minimum, maxNotional: notional ? nonnegative(notional.maxNotional) : "0",
      applyMinToMarket: notional?.applyMinToMarket === true || minNotional?.applyToMarket === true,
      applyMaxToMarket: notional?.applyMaxToMarket === true,
      avgPriceMins: integer((notional ?? minNotional)!.avgPriceMins),
      ...(marketLot ? { marketLotSize: asLot(marketLot) } : {}),
    };
  }

  private async orderParameters(input: NewExchangeOrder, replacing = false): Promise<Record<string, string>> {
    this.mutationAllowed();
    symbol(input.symbol); clientId(input.clientOrderId);
    if ((input.side !== "BUY" && input.side !== "SELL") || (input.type !== "MARKET" && input.type !== "STOP_LOSS")) {
      throw new BinanceOrderError(-1, 0, "Tipo o sentido de orden inválido.");
    }
    if ((input.quantity === undefined) === (input.quoteOrderQty === undefined)) {
      throw new BinanceOrderError(-1, 0, "La orden requiere quantity o quoteOrderQty, exclusivamente.");
    }
    if (input.type === "STOP_LOSS" && (input.side !== "SELL" || input.quantity === undefined || input.stopPrice === undefined)) {
      throw new BinanceOrderError(-1, 0, "El stop protector requiere venta, cantidad y precio de activación.");
    }
    if (input.type === "MARKET" && input.stopPrice !== undefined) throw new BinanceOrderError(-1, 0, "MARKET no admite stopPrice.");
    const rules = await this.getRules(input.symbol);
    if (rules.status !== "TRADING" || !rules.orderTypes.includes(input.type) || (replacing && !rules.cancelReplaceAllowed)) {
      throw new BinanceOrderError(-1013, 0, "El símbolo no admite esta operación en el entorno seleccionado.");
    }
    const params: Record<string, string> = { symbol: input.symbol, side: input.side, type: input.type,
      newClientOrderId: input.clientOrderId, newOrderRespType: "RESULT" };
    if (input.quantity !== undefined) {
      params.quantity = positive(input.quantity);
      checkRange(params.quantity, rules.minQty, rules.maxQty, "Cantidad");
      checkStep(params.quantity, rules.stepSize, "Cantidad");
      if (input.type === "MARKET" && rules.marketLotSize) {
        checkRange(params.quantity, rules.marketLotSize.minQty, rules.marketLotSize.maxQty, "Cantidad MARKET");
        checkStep(params.quantity, rules.marketLotSize.stepSize, "Cantidad MARKET");
      }
    }
    if (input.quoteOrderQty !== undefined) {
      params.quoteOrderQty = positive(input.quoteOrderQty);
      if ((params.quoteOrderQty.split(".")[1]?.length ?? 0) > rules.quoteAssetPrecision) {
        throw new BinanceOrderError(-1013, 0, "El importe excede la precisión del activo cotizado.");
      }
    }
    if (input.stopPrice !== undefined) {
      params.stopPrice = positive(input.stopPrice);
      checkRange(params.stopPrice, rules.minPrice, rules.maxPrice, "Precio del stop");
      checkStep(params.stopPrice, rules.tickSize, "Precio del stop");
    }
    const minimum = input.type !== "MARKET" || rules.applyMinToMarket ? rules.minNotional : "0";
    const maximum = input.type !== "MARKET" || rules.applyMaxToMarket ? rules.maxNotional : "0";
    let notional = params.quoteOrderQty;
    if (!notional && (minimum !== "0" || maximum !== "0")) {
      let price = params.stopPrice;
      if (!price) {
        const path = rules.avgPriceMins > 0 ? "/api/v3/avgPrice" : "/api/v3/ticker/price";
        const response = object(await this.request(path, { symbol: input.symbol }, "GET", false));
        if (rules.avgPriceMins > 0 && integer(response.mins) !== rules.avgPriceMins) {
          throw new BinanceOrderError(-1013, 0, "No se pudo verificar la ventana de precio del filtro.");
        }
        price = positive(text(response.price));
      }
      notional = multiply(params.quantity, price);
    }
    if (notional) checkRange(notional, minimum, maximum, "Notional");
    return params;
  }

  async placeOrder(input: NewExchangeOrder): Promise<ExchangeOrder> {
    const params = await this.orderParameters(input);
    const response = await this.request("/api/v3/order", params, "POST");
    try {
      const parsed = order(response, input.symbol);
      if (parsed.clientOrderId !== input.clientOrderId || parsed.side !== input.side || parsed.type !== input.type) throw new Error("Orden incompatible.");
      return parsed;
    } catch { throw new UnknownExecutionError(); }
  }

  async getOrder(pair: string, lookup: { orderId?: string; clientOrderId?: string }): Promise<ExchangeOrder | null> {
    if ((lookup.orderId === undefined) === (lookup.clientOrderId === undefined)) throw new BinanceOrderError(-1, 0, "La consulta requiere un identificador único.");
    const params = { symbol: symbol(pair), ...(lookup.orderId !== undefined
      ? { orderId: identifier(lookup.orderId) } : { origClientOrderId: clientId(lookup.clientOrderId!) }) };
    try {
      const parsed = order(await this.request("/api/v3/order", params), pair);
      if ((lookup.orderId !== undefined && parsed.orderId !== lookup.orderId) || (lookup.clientOrderId !== undefined && parsed.clientOrderId !== lookup.clientOrderId)) {
        throw new Error("La respuesta no corresponde a la orden consultada.");
      }
      return parsed;
    } catch (error) {
      if (error instanceof BinanceOrderError && error.code === -2013) return null;
      throw error;
    }
  }

  async cancelReplace(input: { symbol: string; orderId: string; newOrder: NewExchangeOrder }): Promise<CancelReplaceResult> {
    this.mutationAllowed();
    if (input.symbol !== input.newOrder.symbol) throw new BinanceOrderError(-1, 0, "El reemplazo debe conservar el símbolo.");
    const params = await this.orderParameters(input.newOrder, true);
    const response = await this.request("/api/v3/order/cancelReplace", {
      ...params, cancelOrderId: identifier(input.orderId), cancelReplaceMode: "STOP_ON_FAILURE",
      // Si el stop se disparó mientras preparábamos el reemplazo, la cantidad
      // calculada puede estar desactualizada. No vender saldo ajeno: rechazar
      // atómicamente la cancelación de cualquier orden que ya no esté NEW.
      cancelRestrictions: "ONLY_NEW", orderRateLimitExceededMode: "DO_NOTHING",
    }, "POST", true, true);
    try {
      const row = object(response);
      if ((row.cancelResult !== "SUCCESS" && row.cancelResult !== "FAILURE") ||
        (row.newOrderResult !== "SUCCESS" && row.newOrderResult !== "FAILURE" && row.newOrderResult !== "NOT_ATTEMPTED")) throw new Error("Resultado parcial inválido.");
      const result: CancelReplaceResult = { cancelResult: row.cancelResult, newOrderResult: row.newOrderResult };
      if (result.cancelResult === "SUCCESS") {
        result.canceledOrder = order(row.cancelResponse, input.symbol);
        if (result.canceledOrder.orderId !== input.orderId) throw new Error("Cancelación incompatible.");
      } else result.cancelError = rejection(row.cancelResponse);
      if (result.newOrderResult === "SUCCESS") {
        result.newOrder = order(row.newOrderResponse, input.symbol);
        if (result.newOrder.clientOrderId !== input.newOrder.clientOrderId || result.newOrder.side !== input.newOrder.side || result.newOrder.type !== input.newOrder.type) throw new Error("Reemplazo incompatible.");
      } else if (result.newOrderResult === "FAILURE") result.newOrderError = rejection(row.newOrderResponse);
      return result;
    } catch { throw new UnknownExecutionError(); }
  }

  async listTrades(pair: string, orderId: string): Promise<ExchangeFill[]> {
    symbol(pair); identifier(orderId);
    const fills = new Map<string, ExchangeFill>();
    let fromId = "0";
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = array(await this.request("/api/v3/myTrades", { symbol: pair, orderId, fromId, limit: String(PAGE_SIZE) }));
      for (const row of rows) {
        const parsed = fill(row, pair, orderId);
        if (BigInt(parsed.id) < BigInt(fromId)) throw new Error("Binance no avanzó la página de fills.");
        fills.set(parsed.id, parsed);
      }
      if (rows.length < PAGE_SIZE) return [...fills.values()];
      const next = rows.map(value => BigInt(identifier(object(value).id))).reduce((a, b) => a > b ? a : b) + BigInt(1);
      if (next <= BigInt(fromId)) throw new Error("Historial de fills incompleto.");
      fromId = next.toString();
    }
    throw new Error("Historial de fills excede el límite de recuperación; requiere revisión.");
  }

  async listOrders(pair: string, startTime: number, endTime: number): Promise<ExchangeOrder[]> {
    symbol(pair);
    if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) || startTime < 0 || endTime < startTime) throw new Error("Ventana de recuperación inválida.");
    const orders = new Map<string, ExchangeOrder>();
    let pages = 0;
    for (let start = startTime; start <= endTime; start += DAY) {
      const end = Math.min(start + DAY - 1, endTime);
      let orderId = "0";
      for (;;) {
        if (++pages > MAX_PAGES) throw new Error("Historial de órdenes excede el límite de recuperación; requiere revisión.");
        const rows = array(await this.request("/api/v3/allOrders", { symbol: pair, startTime: String(start), endTime: String(end), orderId, limit: String(PAGE_SIZE) }));
        for (const row of rows) {
          const parsed = order(row, pair);
          if (BigInt(parsed.orderId) < BigInt(orderId)) throw new Error("Binance no avanzó la página de órdenes.");
          orders.set(parsed.orderId, parsed);
        }
        if (rows.length < PAGE_SIZE) break;
        const next = rows.map(value => BigInt(identifier(object(value).orderId))).reduce((a, b) => a > b ? a : b) + BigInt(1);
        if (next <= BigInt(orderId)) throw new Error("Historial de órdenes incompleto.");
        orderId = next.toString();
      }
    }
    return [...orders.values()];
  }
}
