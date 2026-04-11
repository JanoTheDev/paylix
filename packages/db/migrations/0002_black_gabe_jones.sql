ALTER TYPE "public"."checkout_status" ADD VALUE 'awaiting_currency' BEFORE 'active';--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"network_key" text NOT NULL,
	"token_symbol" text NOT NULL,
	"amount" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_unique" UNIQUE("product_id","network_key","token_symbol")
);
--> statement-breakpoint
CREATE TABLE "merchant_payout_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"network_key" text NOT NULL,
	"wallet_address" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_payout_wallets_unique" UNIQUE("user_id","network_key")
);
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ALTER COLUMN "amount" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "network_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "token_symbol" text NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "network_key" text;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "token_symbol" text;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_payout_wallets" ADD CONSTRAINT "merchant_payout_wallets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_prices_product_idx" ON "product_prices" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "price";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "chain";--> statement-breakpoint
ALTER TABLE "checkout_sessions" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "checkout_sessions" DROP COLUMN "chain";