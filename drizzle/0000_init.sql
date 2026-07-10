CREATE TABLE "backtest_usage" (
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "backtest_usage_user_id_period_pk" PRIMARY KEY("user_id","period")
);
--> statement-breakpoint
CREATE TABLE "binance_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_secret_encrypted" text NOT NULL,
	"is_testnet" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"symbol" text NOT NULL,
	"interval" text DEFAULT '1h' NOT NULL,
	"budget_usdt" double precision NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"position_qty" double precision DEFAULT 0 NOT NULL,
	"position_avg_price" double precision DEFAULT 0 NOT NULL,
	"invested_usdt" double precision DEFAULT 0 NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stop_price" double precision,
	"highest_close" double precision,
	"cooldown_until" timestamp with time zone,
	"last_candle_time" double precision,
	"last_signal" text,
	"last_error" text,
	"last_run_at" timestamp with time zone,
	"last_buy_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_id" integer,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"qty" double precision NOT NULL,
	"price" double precision NOT NULL,
	"quote_qty" double precision NOT NULL,
	"binance_order_id" bigint,
	"reason" text NOT NULL,
	"is_testnet" boolean DEFAULT true NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"granted_by" text NOT NULL,
	"motivo" text,
	"vence" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"snapshot" jsonb,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mp_payment_id" text NOT NULL,
	"amount_ars" double precision NOT NULL,
	"status" text NOT NULL,
	"tipo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_mp_payment_id_unique" UNIQUE("mp_payment_id")
);
--> statement-breakpoint
CREATE TABLE "plan_prices" (
	"plan" text PRIMARY KEY NOT NULL,
	"mensual_ars" double precision NOT NULL,
	"anual_ars" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"total_value_usd" double precision NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"tipo" text DEFAULT 'mensual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"mp_preapproval_id" text,
	"amount_ars" double precision DEFAULT 0 NOT NULL,
	"current_period_end" timestamp with time zone,
	"failed_since" timestamp with time zone,
	"last_notified_state" text,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"bot_token_encrypted" text NOT NULL,
	"chat_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"risk_profile" text NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_configs_user_idx" ON "bot_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grants_user_idx" ON "grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_idx" ON "legal_acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_user_idx" ON "portfolio_snapshots" USING btree ("user_id");