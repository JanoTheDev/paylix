-- Tax breakdown on checkout_sessions + payments.
--
-- checkout_sessions.subtotal_amount already exists (bigint). Add the
-- tax amount (bigint, native token units) and its rate/label so the
-- relay can reconstruct the breakdown without re-resolving from
-- country tables.
--
-- payments gets integer cents columns matching invoices' convention.

ALTER TABLE "checkout_sessions"
  ADD COLUMN "tax_amount" bigint,
  ADD COLUMN "tax_rate_bps" integer,
  ADD COLUMN "tax_label" text;

ALTER TABLE "payments"
  ADD COLUMN "tax_cents" integer NOT NULL DEFAULT 0,
  ADD COLUMN "tax_rate_bps" integer,
  ADD COLUMN "tax_label" text,
  ADD COLUMN "subtotal_cents" integer;
