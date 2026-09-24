import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { NewExchangeOrder } from "../lib/binance/orders";

// Credenciales de Binance por usuario (el id es el de Clerk).
// api_key/api_secret se guardan cifradas con AES-256-GCM — nunca en claro.
export const binanceCredentials = pgTable("binance_credentials", {
  userId: text("user_id").primaryKey(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  apiSecretEncrypted: text("api_secret_encrypted").notNull(),
  isTestnet: boolean("is_testnet").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Perfil de inversor (resultado del cuestionario paso a paso).
export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  riskProfile: text("risk_profile").notNull(), // conservador | moderado | arriesgado
  answers: jsonb("answers").notNull(), // respuestas crudas, por si recalibramos el puntaje
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Configuración de robots: cada usuario puede tener varios (uno por par).
export const botConfigs = pgTable(
  "bot_configs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    strategyId: text("strategy_id").notNull(),
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull().default("1h"),
    budgetUsdt: doublePrecision("budget_usdt").notNull(),
    status: text("status").notNull().default("active"), // active | paused
    // Posición que abrió el bot (independiente del resto de la cartera).
    positionQty: doublePrecision("position_qty").notNull().default(0),
    positionAvgPrice: doublePrecision("position_avg_price").notNull().default(0),
    investedUsdt: doublePrecision("invested_usdt").notNull().default(0),
    // Identidad recuperable y cantidades exactas del nuevo ejecutor. Las
    // columnas numéricas anteriores siguen siendo la proyección para la UI.
    tradingId: uuid("trading_id").notNull().defaultRandom().unique(),
    tradingEnvironment: text("trading_environment").$type<"testnet" | "mainnet">(),
    exchangeAccountId: text("exchange_account_id"),
    recoveryState: text("recovery_state").$type<"legacy" | "ready" | "review">().notNull().default("legacy"),
    recoveryReason: text("recovery_reason"),
    positionQtyExact: text("position_qty_exact").notNull().default("0"),
    positionCostExact: text("position_cost_exact").notNull().default("0"),
    investedUsdtExact: text("invested_usdt_exact").notNull().default("0"),
    confirmedStopPrice: text("confirmed_stop_price"),
    protectionIntentId: uuid("protection_intent_id"),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    params: jsonb("params").notNull().default({}),
    // Estado del overlay de riesgo (stop loss / trailing por ATR).
    stopPrice: doublePrecision("stop_price"),
    highestClose: doublePrecision("highest_close"),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    // Idempotencia: última vela (openTime) ya procesada — un reinicio del
    // proceso nunca debe disparar dos órdenes por la misma señal.
    lastCandleTime: doublePrecision("last_candle_time"),
    // Última vela que MIRÓ el vigía de robots pausados (solo dedup de avisos;
    // NO toca last_candle_time — si el usuario reanuda a tiempo, el robot
    // todavía agarra la vela de la señal gracias a la ventana de gracia).
    watchedCandleTime: doublePrecision("watched_candle_time"),
    lastSignal: text("last_signal"),
    lastError: text("last_error"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastBuyAt: timestamp("last_buy_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("bot_configs_user_idx").on(table.userId)]
);

export type TradingIntentState = "planned" | "submitting" | "unknown" | "open" | "filled" | "canceled" | "rejected" | "review";
export type TradingIntentAction = "buy" | "sell" | "protect" | "replace";
export type TradingIntentMetadata = {
  reason?: string;
  intervalMs?: number;
  exitReason?: "stop" | "signal";
  protection?: { atr: number | null; stopMultiple: number };
};

// La intención se confirma localmente ANTES de hacer el request remoto.
// No contiene secretos; una respuesta perdida conserva el mismo client ID.
export const botOrderIntents = pgTable("bot_order_intents", {
  id: uuid("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => botConfigs.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull(),
  environment: text("environment").$type<"testnet" | "mainnet">().notNull(),
  accountId: text("account_id").notNull(),
  symbol: text("symbol").notNull(),
  action: text("action").$type<TradingIntentAction>().notNull(),
  clientOrderId: text("client_order_id").notNull(),
  state: text("state").$type<TradingIntentState>().notNull().default("planned"),
  request: jsonb("request").$type<NewExchangeOrder>().notNull(),
  metadata: jsonb("metadata").$type<TradingIntentMetadata>().notNull().default({}),
  exchangeOrderId: text("exchange_order_id"),
  executedQty: text("executed_qty").notNull().default("0"),
  quoteQty: text("quote_qty").notNull().default("0"),
  stopPrice: text("stop_price"),
  replacesIntentId: uuid("replaces_intent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("bot_order_intents_bot_idx").on(table.botId),
  uniqueIndex("bot_order_intents_client_idx").on(table.environment, table.accountId, table.clientOrderId),
  uniqueIndex("bot_order_intents_exchange_idx").on(table.environment, table.accountId, table.symbol, table.exchangeOrderId),
  check("bot_order_intents_environment_check", sql`${table.environment} in ('testnet','mainnet')`),
  check("bot_order_intents_action_check", sql`${table.action} in ('buy','sell','protect','replace')`),
  check("bot_order_intents_state_check", sql`${table.state} in ('planned','submitting','unknown','open','filled','canceled','rejected','review')`),
]);

// Un fill pertenece a un único journal, incluso si se consulta varias veces
// o dos workers intentan aplicar el mismo snapshot al mismo tiempo.
export const botOrderFills = pgTable("bot_order_fills", {
  intentId: uuid("intent_id").notNull().references(() => botOrderIntents.id, { onDelete: "restrict" }),
  environment: text("environment").$type<"testnet" | "mainnet">().notNull(),
  accountId: text("account_id").notNull(),
  symbol: text("symbol").notNull(),
  tradeId: text("trade_id").notNull(),
  orderId: text("order_id").notNull(),
  qty: text("qty").notNull(),
  quoteQty: text("quote_qty").notNull(),
  price: text("price").notNull(),
  commission: text("commission").notNull(),
  commissionAsset: text("commission_asset").notNull(),
  time: bigint("time", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.accountId, table.symbol, table.tradeId] }),
  index("bot_order_fills_intent_idx").on(table.intentId),
]);

// Snapshots del valor total de la cartera: alimentan el gráfico de evolución.
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    totalValueUsd: doublePrecision("total_value_usd").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("portfolio_snapshots_user_idx").on(table.userId)]
);

// Suscripción de pago (una por usuario). Los estados siguen la máquina de
// cobranza de BUSINESS.md: active → pago_fallido → en_gracia → pausa_suave
// → cancelada. En pausa_suave el robot NO abre posiciones pero los stops y
// ventas siguen activos (jamás se corta la protección por deuda).
export const subscriptions = pgTable("subscriptions", {
  userId: text("user_id").primaryKey(),
  plan: text("plan").notNull(), // real | pro
  tipo: text("tipo").notNull().default("mensual"), // mensual | anual
  status: text("status").notNull().default("active"),
  mpPreapprovalId: text("mp_preapproval_id"),
  amountArs: doublePrecision("amount_ars").notNull().default(0),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  failedSince: timestamp("failed_since", { withTimezone: true }),
  lastNotifiedState: text("last_notified_state"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Cortesías: plan efectivo = max(suscripción activa, grant vigente).
export const grants = pgTable(
  "grants",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    plan: text("plan").notNull(), // real | pro
    grantedBy: text("granted_by").notNull(),
    motivo: text("motivo"),
    vence: timestamp("vence", { withTimezone: true }), // null = sin vencimiento
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("grants_user_idx").on(table.userId)]
);

// Pagos recibidos (auditoría). mp_payment_id único = idempotencia de webhooks.
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  mpPaymentId: text("mp_payment_id").notNull().unique(),
  amountArs: doublePrecision("amount_ars").notNull(),
  status: text("status").notNull(),
  tipo: text("tipo").notNull(), // mensual | anual | rescate
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Precios vigentes por plan, editables desde /admin/planes (los defaults
// viven en src/config/plans.ts). Los checkouts nuevos usan siempre el precio
// de acá; las suscripciones ya activas mantienen su monto.
export const planPrices = pgTable("plan_prices", {
  plan: text("plan").primaryKey(), // real | pro
  mensualArs: doublePrecision("mensual_ars").notNull(),
  anualArs: doublePrecision("anual_ars").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Contador mensual de backtests del plan gratis (period = "YYYY-MM").
export const backtestUsage = pgTable(
  "backtest_usage",
  {
    userId: text("user_id").notNull(),
    period: text("period").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.period] })]
);

// Registro de aceptaciones legales (consentimiento informado). Nunca se
// borra: es la principal prueba ante un reclamo. document ∈ tos | privacy |
// risk | binance_connect | robot_real. snapshot guarda la config del robot
// al aceptar operar en real.
export const legalAcceptances = pgTable(
  "legal_acceptances",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    document: text("document").notNull(),
    version: text("version").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    snapshot: jsonb("snapshot"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("legal_acceptances_user_idx").on(table.userId)]
);

// Notificaciones por Telegram: el token del bot del usuario va cifrado.
export const telegramSettings = pgTable("telegram_settings", {
  userId: text("user_id").primaryKey(),
  botTokenEncrypted: text("bot_token_encrypted").notNull(),
  chatId: text("chat_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  // Parte de cada revisión de vela (además de las operaciones): "el robot
  // está vivo y esto es lo que vio". Puede ser un mensaje por hora según la
  // estrategia — por eso es opt-in.
  candleReports: boolean("candle_reports").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Historial de operaciones ejecutadas por el robot.
export const botTrades = pgTable("bot_trades", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id"),
  userId: text("user_id").notNull(),
  strategyId: text("strategy_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // BUY | SELL
  qty: doublePrecision("qty").notNull(),
  price: doublePrecision("price").notNull(),
  quoteQty: doublePrecision("quote_qty").notNull(),
  // bigint: los orderId del mainnet de Binance superan el rango de int4.
  binanceOrderId: bigint("binance_order_id", { mode: "number" }),
  reason: text("reason").notNull(),
  isTestnet: boolean("is_testnet").notNull().default(true),
  executedAt: timestamp("executed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
