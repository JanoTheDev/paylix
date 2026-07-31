-- SC-03: store the buyer's signed platform-fee ceiling on the checkout session.
--
-- The contracts now bind `maxFeeBps` into the PaymentIntent /
-- SubscriptionIntent / SubscriptionIntentDiscount typehashes and enforce
-- `require(platformFee <= maxFeeBps)` at settlement (PaymentVault.sol:148,
-- SubscriptionManager.sol:267), closing the hole where the platform owner could
-- raise `setPlatformFee` retroactively against already-signed intents.
--
-- That ceiling has to originate server-side. It is LOCKED AT QUOTE TIME and
-- stored here rather than read live when the buyer signs: a live read races an
-- owner fee raise occurring between quote and signature, which is precisely the
-- attack SC-03 closes. Only a stored ceiling actually holds.
--
-- Basis points against PaymentVault.MAX_PLATFORM_FEE_BPS = 1000 (10%), so 50
-- means 0.5%.
--
-- NULLABLE on purpose. This column records what a buyer AGREED TO, so
-- back-filling a default would assert consent that was never given, and for
-- sessions quoted before this column existed the correct value is unknowable.
-- The client fails closed — it refuses to request a signature without a
-- ceiling — so NULL degrades to "gasless checkout unavailable for this stale
-- session", never to an unsafe default. Promoting it to NOT NULL is tracked in
-- audit/_schema-followups.md once both session-creation sites populate it.
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "max_fee_bps" integer;--> statement-breakpoint

-- Last line of defence: a bug writing 10000 here would be the buyer signing
-- away a 100% fee ceiling. Allows NULL, constrains every real value to the
-- contract's own bound.
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_sessions_max_fee_bps_range') THEN
		ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_max_fee_bps_range"
			CHECK ("max_fee_bps" IS NULL OR ("max_fee_bps" >= 0 AND "max_fee_bps" <= 1000));
	END IF;
END $$;
