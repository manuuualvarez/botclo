import { compare } from "../binance/decimal";
import type { BinanceEnvironment } from "../binance/orders";

export interface GuardBot {
  id: number;
  userId: string;
  status: string;
  symbol: string;
  positionQty: number;
  positionQtyExact: string;
  recoveryState: string;
  tradingEnvironment: BinanceEnvironment | null;
  exchangeAccountId: string | null;
  protectionIntentId: string | null;
  confirmedStopPrice: string | null;
}
export interface GuardIntent { botId: number; state: string }
export class TradingGuardError extends Error {
  constructor(message: string) { super(message); this.name = "TradingGuardError"; }
}
type RemovalDecision = { kind: "blocked"; error: string } | { kind: "archive" | "delete" };
const terminal = new Set(["filled", "canceled", "rejected"]);

function hasExposure(bot: GuardBot, intents: GuardIntent[]): boolean {
  try {
    if (!Number.isFinite(bot.positionQty) || bot.positionQty !== 0 || compare(bot.positionQtyExact, "0") !== 0) return true;
  } catch { return true; }
  return bot.protectionIntentId !== null || bot.confirmedStopPrice !== null || bot.recoveryState === "review" ||
    intents.some((intent) => intent.botId === bot.id && !terminal.has(intent.state));
}

export function removalDecision(bot: GuardBot, intents: GuardIntent[]): RemovalDecision {
  if (hasExposure(bot, intents)) {
    return { kind: "blocked", error: "Este robot tiene una posición, una protección o una operación pendiente de conciliar. Resolvé ese estado antes de eliminarlo o desconectar Binance." };
  }
  return { kind: intents.some((intent) => intent.botId === bot.id) ? "archive" : "delete" };
}

export function assertCanDisconnect(bots: GuardBot[], intents: GuardIntent[]): void {
  for (const bot of bots) {
    const decision = removalDecision(bot, intents);
    if (decision.kind === "blocked") throw new TradingGuardError(decision.error);
  }
}

export function assertRequestedStatus(status: unknown): "active" | "paused" {
  if (status !== "active" && status !== "paused") throw new TradingGuardError("El estado del robot no es válido.");
  return status;
}

export async function withOwnedTradingBot<T, B extends GuardBot>(botId: unknown, dependencies: {
  withLock: <R>(work: () => Promise<R>) => Promise<R>;
  authenticate: () => Promise<string | null>;
  readBot: (userId: string, botId: number) => Promise<B | undefined | null>;
}, mutate: (bot: B) => Promise<T>): Promise<T> {
  if (typeof botId !== "number" || !Number.isSafeInteger(botId) || botId <= 0) throw new TradingGuardError("El identificador del robot no es válido.");
  return dependencies.withLock(async () => {
    const userId = await dependencies.authenticate();
    if (!userId) throw new TradingGuardError("Tu sesión expiró. Volvé a ingresar.");
    const bot = await dependencies.readBot(userId, botId);
    if (!bot || bot.userId !== userId || bot.id !== botId || bot.status === "archived") throw new TradingGuardError("No encontramos ese robot.");
    return mutate(bot);
  });
}

export function assertCredentialEnvironment(storedIsTestnet: boolean, environment: BinanceEnvironment): void {
  if (storedIsTestnet !== (environment === "testnet")) {
    throw new TradingGuardError("Las credenciales guardadas pertenecen a otro entorno de Binance. Revisá la configuración antes de operar.");
  }
}

export function needsPreviousAccount(bots: GuardBot[], intents: GuardIntent[]): boolean {
  return bots.some((bot) => (bot.exchangeAccountId === null || bot.tradingEnvironment === null) && hasExposure(bot, intents));
}

export function assertCredentialRotation(bots: GuardBot[], intents: GuardIntent[], environment: BinanceEnvironment,
  nextAccountId: string, previous?: { environment: BinanceEnvironment; accountId: string }): void {
  for (const bot of bots) {
    const exposed = hasExposure(bot, intents);
    if (bot.status === "archived" && !exposed) continue;
    if (bot.tradingEnvironment !== null && bot.tradingEnvironment !== environment) throw new TradingGuardError("No podés cambiar el entorno de Binance de un robot existente.");
    if (bot.exchangeAccountId !== null && bot.exchangeAccountId !== nextAccountId) throw new TradingGuardError("Estas claves pertenecen a otra cuenta de Binance. Los robots existentes deben conservar su cuenta.");
    if (exposed && (bot.exchangeAccountId === null || bot.tradingEnvironment === null)) {
      if (!previous) throw new TradingGuardError("No pudimos verificar la cuenta anterior. Hace falta conciliar los robots antes de reemplazar sus claves.");
      if (previous.environment !== environment) throw new TradingGuardError("La cuenta anterior pertenece a otro entorno de Binance.");
      if (previous.accountId !== nextAccountId) throw new TradingGuardError("Estas claves pertenecen a otra cuenta de Binance y hay posiciones abiertas en la cuenta anterior.");
    }
  }
}

// Nunca devolvemos a la UI errores arbitrarios de DB/fetch que puedan incluir
// queries, datos de cuenta o URLs firmadas.
export function tradingActionError(error: unknown): string {
  return error instanceof TradingGuardError ? error.message : "No pudimos completar el cambio. Puede haber otra revisión en curso; esperá unos segundos y volvé a intentar.";
}
