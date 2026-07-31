-- Schema changes requested by the indexer agents via audit/_requests-*.md.
-- All additive: every column is nullable or has a default, so existing insert
-- sites in apps/web and packages/indexer keep compiling and running unchanged.

-- IDX-20 (audit/_requests-indexer-evm.md #1): record which relayer transaction
-- a trial conversion is waiting on, so the reference survives a restart.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_conversion_tx_hash" text;--> statement-breakpoint

-- IDX-26 (audit/_requests-indexer-evm.md #2): exponential backoff + a terminal
-- state for the unmatched-event retry queue. Without next_attempt_at every
-- retained event is replayed on every 30s pass; without status a permanently
-- unmatchable event has no operator-visible state.
ALTER TABLE "unmatched_events" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "unmatched_events" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unmatched_events_retry_idx" ON "unmatched_events" USING btree ("status","next_attempt_at");--> statement-breakpoint

-- IDX-27 (audit/_requests-indexer-evm.md #3): let the indexer look a session up
-- by keccak256(session.id) instead of brute-force hashing the 200 most recent
-- open sessions. NULL for rows created before apps/web starts populating it;
-- the indexer keeps the scan as a fallback for those.
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "customer_id_hash" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_customer_id_hash_idx" ON "checkout_sessions" USING btree ("customer_id_hash");--> statement-breakpoint

-- IDX-04 (audit/_requests-indexer-nonevm.md #1): payments.amount is integer
-- cents and cannot honestly carry a satoshi amount — the conversion assumes one
-- whole coin == $1.00, correct for a dollar-pegged stablecoin and wrong for
-- BTC/LTC, so sub-cent amounts round to 0. Keep the exact native amount plus a
-- fiat rate snapshot captured when the buyer is quoted.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "amount_sats" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "fiat_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "fiat_rate_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "fiat_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "fiat_rate_captured_at" timestamp with time zone;
