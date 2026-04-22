CREATE TABLE "customer_wallets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "address" text NOT NULL,
  "nickname" text,
  "is_primary" boolean NOT NULL DEFAULT false,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "customer_wallets_addr_idx" ON "customer_wallets" ("customer_id", "address");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_wallets_primary_idx" ON "customer_wallets" ("customer_id") WHERE is_primary = true;--> statement-breakpoint
CREATE INDEX "customer_wallets_customer_idx" ON "customer_wallets" ("customer_id");--> statement-breakpoint
-- Backfill: every existing customer with a walletAddress gets a primary row.
INSERT INTO "customer_wallets" ("customer_id", "address", "is_primary")
SELECT "id", "wallet_address", true
FROM "customers"
WHERE "wallet_address" IS NOT NULL AND "wallet_address" <> ''
ON CONFLICT DO NOTHING;
