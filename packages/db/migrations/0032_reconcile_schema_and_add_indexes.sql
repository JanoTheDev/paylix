-- Reconcile the migration chain with packages/db/src/schema/** and add the
-- missing indexes.
--
-- WHY THIS EXISTS:
-- Even after 0031 repaired the organization rename, the migration chain still
-- produced a schema that differed from the Drizzle definitions in ~15 ways
-- that no migration ever covered (audit DB-02/DB-03 fallout): the
-- subscription_status enum was missing 'trialing' and
-- 'trial_conversion_failed', the whole free-trial column set was absent, and
-- checkout buyer fields, customers.deleted_at, merchant_profiles notification
-- settings and products.trial_days/trial_minutes were never migrated. This
-- file closes the gap and then adds the indexes from DB-04..DB-09.
--
-- NOTE ON `CREATE INDEX CONCURRENTLY`:
-- drizzle-orm's migrator executes the entire chain inside a single
-- transaction (pg-core/dialect.js: `session.transaction(...)`), and Postgres
-- forbids CREATE INDEX CONCURRENTLY inside a transaction block. These indexes
-- therefore take a normal ShareLock on write traffic while they build. For a
-- large live deployment, build them out-of-band with CONCURRENTLY first — the
-- `IF NOT EXISTS` guards below then make this migration a no-op for them.

-- ---------------------------------------------------------------------------
-- 1. Enum values the schema declares but no migration added.
--
-- WARNING FOR FUTURE MIGRATIONS: drizzle runs the whole chain in one
-- transaction, and Postgres forbids *using* an enum value that was added
-- earlier in the same transaction. So a later migration that writes
-- 'trialing' or 'trial_conversion_failed' as a literal — an UPDATE, a
-- backfill, a DEFAULT, or a partial-index WHERE clause — will fail on a FRESH
-- database (where these ADD VALUEs run in that same transaction) while
-- succeeding on an already-migrated one, which is a nasty asymmetry to debug.
-- If you need such a literal, cast it (`'trialing'::text`) against a text
-- column, or land the enum change in its own release ahead of the usage.
-- ---------------------------------------------------------------------------
ALTER TYPE "public"."subscription_status" ADD VALUE IF NOT EXISTS 'trialing';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE IF NOT EXISTS 'trial_conversion_failed';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Columns the schema declares but no migration added.
-- ---------------------------------------------------------------------------
ALTER TABLE "merchant_profiles" ADD COLUMN IF NOT EXISTS "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb DEFAULT '{"invoice":true,"trialStarted":true,"trialEndingSoon":true,"trialConverted":true,"trialFailed":true,"subscriptionCreated":true,"subscriptionCancelled":true,"paymentReceipt":true,"pastDue":true,"checkoutRecovery":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trial_days" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trial_minutes" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pending_permit_signature" jsonb;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_conversion_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_conversion_last_error" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_conversion_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "buyer_first_name" text;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "buyer_last_name" text;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "buyer_email" text;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "buyer_phone" text;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "checkout_field_defaults" SET DEFAULT '{"firstName":true,"lastName":true,"email":true,"phone":false}'::jsonb;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. DB-15: refunds needs a chain discriminator. A tx hash is only unique per
--    chain. Backfill from the parent payment before swapping the unique index.
-- ---------------------------------------------------------------------------
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "network_key" text DEFAULT 'base' NOT NULL;--> statement-breakpoint
UPDATE "refunds" r
SET "network_key" = p."chain"
FROM "payments" p
WHERE p."id" = r."payment_id" AND r."network_key" IS DISTINCT FROM p."chain";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Foreign keys whose NAME alone differs from drizzle's convention.
--    Migrations 0018-0028 declared these inline in CREATE TABLE, so Postgres
--    auto-named them `<table>_<col>_fkey` while the schema expects
--    `<table>_<col>_<reftable>_<refcol>_fk`. RENAME CONSTRAINT is a catalog-only
--    operation — unlike DROP + ADD it does not re-validate the constraint or
--    hold a lock while scanning the table, which matters on a live database.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
	r record;
	renames text[][] := ARRAY[
		['coupons', 'coupons_organization_id_fkey', 'coupons_organization_id_organization_id_fk'],
		['coupon_redemptions', 'coupon_redemptions_coupon_id_fkey', 'coupon_redemptions_coupon_id_coupons_id_fk'],
		['coupon_redemptions', 'coupon_redemptions_organization_id_fkey', 'coupon_redemptions_organization_id_organization_id_fk'],
		['coupon_redemptions', 'coupon_redemptions_checkout_session_id_fkey', 'coupon_redemptions_checkout_session_id_checkout_sessions_id_fk'],
		['coupon_redemptions', 'coupon_redemptions_subscription_id_fkey', 'coupon_redemptions_subscription_id_subscriptions_id_fk'],
		['coupon_redemptions', 'coupon_redemptions_payment_id_fkey', 'coupon_redemptions_payment_id_payments_id_fk'],
		['payment_links', 'payment_links_organization_id_fkey', 'payment_links_organization_id_organization_id_fk'],
		['payment_links', 'payment_links_product_id_fkey', 'payment_links_product_id_products_id_fk'],
		['blocklist_entries', 'blocklist_entries_organization_id_fkey', 'blocklist_entries_organization_id_organization_id_fk'],
		['refunds', 'refunds_payment_id_fkey', 'refunds_payment_id_payments_id_fk'],
		['refunds', 'refunds_organization_id_fkey', 'refunds_organization_id_organization_id_fk'],
		['customer_notification_preferences', 'customer_notification_preferences_customer_id_fkey', 'customer_notification_preferences_customer_id_customers_id_fk'],
		['refund_requests', 'refund_requests_organization_id_fkey', 'refund_requests_organization_id_organization_id_fk'],
		['refund_requests', 'refund_requests_payment_id_fkey', 'refund_requests_payment_id_payments_id_fk'],
		['refund_requests', 'refund_requests_customer_id_fkey', 'refund_requests_customer_id_customers_id_fk'],
		['refund_requests', 'refund_requests_refund_id_fkey', 'refund_requests_refund_id_refunds_id_fk'],
		['customer_wallets', 'customer_wallets_customer_id_fkey', 'customer_wallets_customer_id_customers_id_fk']
	];
	i int;
BEGIN
	FOR i IN 1 .. array_length(renames, 1) LOOP
		IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = renames[i][2])
		   AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = renames[i][3]) THEN
			EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', renames[i][1], renames[i][2], renames[i][3]);
		END IF;
	END LOOP;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. DB-11 / DB-12: foreign keys whose BEHAVIOUR changes. These genuinely need
--    DROP + ADD. `payments`/`subscriptions` previously defaulted to NO ACTION;
--    the intent is now explicit (restrict for owned rows, set null for the
--    soft pointers). checkout_sessions.applied_coupon_id / payment_id /
--    subscription_id and subscriptions.applied_coupon_id had NO foreign key at
--    all, so a deleted coupon or payment left a dangling pointer that joins
--    silently dropped.
-- ---------------------------------------------------------------------------
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_last_payment_id_payments_id_fk";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_last_payment_id_payments_id_fk" FOREIGN KEY ("last_payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Clear orphaned pointers before the new FKs are validated, otherwise adding
-- them fails on any pre-existing dangling reference.
UPDATE "subscriptions" s SET "applied_coupon_id" = NULL
WHERE s."applied_coupon_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "coupons" c WHERE c."id" = s."applied_coupon_id");--> statement-breakpoint
UPDATE "checkout_sessions" cs SET "applied_coupon_id" = NULL
WHERE cs."applied_coupon_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "coupons" c WHERE c."id" = cs."applied_coupon_id");--> statement-breakpoint
UPDATE "checkout_sessions" cs SET "payment_id" = NULL
WHERE cs."payment_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."id" = cs."payment_id");--> statement-breakpoint
UPDATE "checkout_sessions" cs SET "subscription_id" = NULL
WHERE cs."subscription_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."id" = cs."subscription_id");--> statement-breakpoint

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_applied_coupon_id_coupons_id_fk') THEN
		ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_applied_coupon_id_coupons_id_fk" FOREIGN KEY ("applied_coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_sessions_applied_coupon_id_coupons_id_fk') THEN
		ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_applied_coupon_id_coupons_id_fk" FOREIGN KEY ("applied_coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_sessions_payment_id_payments_id_fk') THEN
		ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_sessions_subscription_id_subscriptions_id_fk') THEN
		ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. DB-09: give idempotency_keys a real primary key.
--    apps/web/lib/idempotency.ts uses an untargeted .onConflictDoNothing(),
--    which resolves against the primary key unchanged.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_organization_id_key_pk') THEN
		ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_key_pk" PRIMARY KEY("organization_id","key");
	END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "idempotency_keys_org_key_idx";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. DB-08: dedup key for the unmatched-event retry queue.
--    NULLS NOT DISTINCT because log_index is nullable and Postgres would
--    otherwise treat every NULL as unique, letting duplicates through — and a
--    duplicate here becomes a DUPLICATE PAYMENT via the retry path.
-- ---------------------------------------------------------------------------
DELETE FROM "unmatched_events" a
USING "unmatched_events" b
WHERE a."id" > b."id"
  AND a."tx_hash" = b."tx_hash"
  AND a."event_type" = b."event_type"
  AND a."log_index" IS NOT DISTINCT FROM b."log_index";--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unmatched_events_dedup_idx') THEN
		ALTER TABLE "unmatched_events" ADD CONSTRAINT "unmatched_events_dedup_idx" UNIQUE NULLS NOT DISTINCT("tx_hash","log_index","event_type");
	END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. DB-10: widen unique keys that must be per-livemode. Widening a unique
--    index only ever relaxes it, so no collision cleanup is required.
--    `customers_org_customer_idx` is deliberately NOT widened — it is an
--    ON CONFLICT target in apps/web and needs a coordinated change.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "invoices_org_number_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_org_number_idx" ON "invoices" USING btree ("organization_id","number","livemode");--> statement-breakpoint
DROP INDEX IF EXISTS "coupons_org_code_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_org_code_idx" ON "coupons" USING btree ("organization_id","code","livemode");--> statement-breakpoint

-- DB-15: swap the globally-unique tx hash for a per-chain one.
DROP INDEX IF EXISTS "refunds_tx_hash_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_network_tx_hash_idx" ON "refunds" USING btree ("network_key","tx_hash");--> statement-breakpoint

-- DB-04: restore the Bitcoin receive-address uniqueness guard.
-- 0030 created this index, but it was never declared in the Drizzle schema, so
-- `db:push` DROPPED it — and every existing deployment is push-built. Those
-- databases have been running without the only thing stopping two checkout
-- sessions from sharing one BTC receive address. Re-created here (and now
-- declared in checkout-sessions.ts) so the push and migrate lineages converge.
--
-- If this statement fails with "could not create unique index ... is
-- duplicated", the database already has colliding sessions from the window in
-- which the guard was missing: resolve those rows before retrying.
CREATE UNIQUE INDEX IF NOT EXISTS "btc_session_address_idx"
  ON "checkout_sessions" ("btc_receive_address")
  WHERE "btc_receive_address" IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. DB-04..DB-08: the missing indexes. See the schema files for the query
--    each one serves.
-- ---------------------------------------------------------------------------
-- subscriptions: the keeper full-scanned this table on every tick.
CREATE INDEX IF NOT EXISTS "subscriptions_due_idx" ON "subscriptions" USING btree ("status","next_charge_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_past_due_idx" ON "subscriptions" USING btree ("status","past_due_since");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_trial_idx" ON "subscriptions" USING btree ("status","trial_ends_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_org_created_idx" ON "subscriptions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_org_product_idx" ON "subscriptions" USING btree ("organization_id","product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_subscriber_lower_idx" ON "subscriptions" USING btree (lower("subscriber_address"));--> statement-breakpoint

-- payments
CREATE INDEX IF NOT EXISTS "payments_org_created_idx" ON "payments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_customer_idx" ON "payments" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_org_status_idx" ON "payments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_product_idx" ON "payments" USING btree ("product_id");--> statement-breakpoint

-- checkout_sessions had no index at all beyond its primary key.
CREATE INDEX IF NOT EXISTS "checkout_sessions_org_created_idx" ON "checkout_sessions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_status_expires_idx" ON "checkout_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_merchant_wallet_lower_idx" ON "checkout_sessions" USING btree (lower("merchant_wallet"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_payment_idx" ON "checkout_sessions" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_subscription_idx" ON "checkout_sessions" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_product_idx" ON "checkout_sessions" USING btree ("product_id");--> statement-breakpoint

-- webhook_deliveries: the retry worker scanned the whole delivery log.
CREATE INDEX IF NOT EXISTS "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_created_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_created_idx" ON "webhook_deliveries" USING btree ("created_at");--> statement-breakpoint

-- customers: trial anti-abuse dedup runs on every trial checkout.
CREATE INDEX IF NOT EXISTS "customers_email_lower_idx" ON "customers" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_org_created_idx" ON "customers" USING btree ("organization_id","created_at");--> statement-breakpoint

-- unmatched_events / idempotency_keys / audit_logs / coupons / refunds / products
CREATE INDEX IF NOT EXISTS "unmatched_events_created_idx" ON "unmatched_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","livemode","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coupons_org_created_idx" ON "coupons" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_org_created_idx" ON "refunds" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_org_created_idx" ON "products" USING btree ("organization_id","created_at");
