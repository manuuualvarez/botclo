CREATE TABLE "bot_order_fills" (
	"intent_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"symbol" text NOT NULL,
	"trade_id" text NOT NULL,
	"order_id" text NOT NULL,
	"qty" text NOT NULL,
	"quote_qty" text NOT NULL,
	"price" text NOT NULL,
	"commission" text NOT NULL,
	"commission_asset" text NOT NULL,
	"time" bigint NOT NULL,
	CONSTRAINT "bot_order_fills_environment_account_id_symbol_trade_id_pk" PRIMARY KEY("environment","account_id","symbol","trade_id")
);
--> statement-breakpoint
CREATE TABLE "bot_order_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bot_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"symbol" text NOT NULL,
	"action" text NOT NULL,
	"client_order_id" text NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"request" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exchange_order_id" text,
	"executed_qty" text DEFAULT '0' NOT NULL,
	"quote_qty" text DEFAULT '0' NOT NULL,
	"stop_price" text,
	"replaces_intent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_order_intents_environment_check" CHECK ("bot_order_intents"."environment" in ('testnet','mainnet')),
	CONSTRAINT "bot_order_intents_action_check" CHECK ("bot_order_intents"."action" in ('buy','sell','protect','replace')),
	CONSTRAINT "bot_order_intents_state_check" CHECK ("bot_order_intents"."state" in ('planned','submitting','unknown','open','filled','canceled','rejected','review'))
);
--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "trading_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "trading_environment" text;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "exchange_account_id" text;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "recovery_state" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "recovery_reason" text;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "position_qty_exact" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "position_cost_exact" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "invested_usdt_exact" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "confirmed_stop_price" text;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "protection_intent_id" uuid;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_configs" ADD COLUMN IF NOT EXISTS "watched_candle_time" double precision;--> statement-breakpoint
ALTER TABLE "telegram_settings" ADD COLUMN IF NOT EXISTS "candle_reports" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "bot_configs" SET
  "position_qty_exact" = "position_qty"::numeric::text,
  "position_cost_exact" = ("position_qty"::numeric * "position_avg_price"::numeric)::text,
  "invested_usdt_exact" = "invested_usdt"::numeric::text;--> statement-breakpoint
ALTER TABLE "bot_order_fills" ADD CONSTRAINT "bot_order_fills_intent_id_bot_order_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."bot_order_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_order_intents" ADD CONSTRAINT "bot_order_intents_bot_id_bot_configs_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bot_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_order_fills_intent_idx" ON "bot_order_fills" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "bot_order_intents_bot_idx" ON "bot_order_intents" USING btree ("bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_order_intents_client_idx" ON "bot_order_intents" USING btree ("environment","account_id","client_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_order_intents_exchange_idx" ON "bot_order_intents" USING btree ("environment","account_id","symbol","exchange_order_id");--> statement-breakpoint
ALTER TABLE "bot_configs" ADD CONSTRAINT "bot_configs_trading_id_unique" UNIQUE("trading_id");
