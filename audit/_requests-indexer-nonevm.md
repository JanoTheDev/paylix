# Schema requests — non-EVM indexers (solana-indexer, utxo-indexer, utxo-watcher, mailer)

Filed by the agent fixing `audit/03-indexers.md` findings in the non-EVM
packages. Each item is something the fix genuinely needs from `packages/db`,
which this agent does not own. Everything implementable without the schema
change has already been implemented; what is listed here is the residual.

---

## 1. `payments.amount_sats` (+ a fiat rate snapshot) — needed by IDX-04

**RESOLVED — shipped and consumed.** The db agent added `payments.amount_sats`,
`payments.fiat_rate_cents`, `payments.fiat_rate_captured_at` and the matching
`checkout_sessions` quote-time snapshot (migration
`0033_indexer_schema_requests.sql`).

`packages/utxo-indexer/src/db-callbacks.ts` now writes the exact satoshi amount
to `amount_sats` and computes `amount` as
`round(sats * fiatRateCents / 1e8)` in bigint arithmetic. When a session has no
rate snapshot the payment is **not** written: the event is retained in
`unmatched_events` as `UtxoPaymentReceivedNoFiatRate` and the session is left
open, because neither of the available guesses is acceptable — satoshis
verbatim reported 0.001 BTC as $1,000.00, and `sats / 10^(8-2)` reports it as
$0.00, which also makes the payment permanently non-refundable via the
`refundedCents + x > amount` cap in `verify-refund.ts`.

**Remaining work, outside this agent's ownership:** nothing populates
`checkout_sessions.fiat_rate_cents` yet. Until `apps/web` captures a rate when
the buyer is quoted, every UTXO payment lands in `unmatched_events` instead of
`payments`. That is deliberate — a retained event is recoverable, a wrong money
value is not — but the web agent needs to close the loop for UTXO checkout to
work end to end.

---

## 2. `unmatched_events` dedup constraint — relevant to the non-EVM paths (IDX-26)

**Finding:** IDX-26 is filed against `packages/indexer`, but both non-EVM
indexers call the same table via their own `recordUnmatched`. With the Solana
listener's new catch-up pass (IDX-03) re-scanning a slot range every 60s, an
unmatchable event is now re-recorded on every pass.

The in-process replay guard in `packages/solana-indexer/src/listener.ts` covers
the common case, but it is bounded and does not survive a restart.

**Requested change (`packages/db/src/schema/unmatched-events.ts`):** a unique
index on `(tx_hash, log_index, event_type)` so `recordUnmatched` can use
`onConflictDoNothing`. Note `log_index` is NULL for Solana rows, so the index
needs `nullsNotDistinct` (or the Solana path needs a synthetic index value) —
whichever the schema owner prefers; the callers will be updated to match.

This is a shared request: the EVM indexer agent is likely filing the same one.

---

## 3. Not requested

- No new tables are needed for the customer-resolution fix (IDX-01). Both
  non-EVM callbacks now upsert into the existing `customers` table and write
  `customers.id` into `payments.customer_id`.
- The Solana slot cursor (IDX-03) reuses the existing `system_status` key/value
  table with the `cursor_*` convention, so no migration is required.

---

## SATISFIED by the `packages/db` agent

- **#1 fiat rate snapshot** — added `payments.amount_sats` (bigint),
  `payments.fiat_rate_cents`, `payments.fiat_rate_captured_at`, and the matching
  `checkout_sessions.fiat_rate_cents` / `checkout_sessions.fiat_rate_captured_at`
  so the rate can be locked when the buyer is quoted rather than when the tx
  confirms (migration `0033_indexer_schema_requests.sql`). All nullable. NOTE (corrected): there is no
  `satsToCents()` fallback — `db-callbacks.ts` and `settlement.ts` refuse the
  cents write and park the event when no rate is present — that writer is listed in `audit/_schema-followups.md` §B.
- **#2 `unmatched_events` dedup** — added as
  `unmatched_events_dedup_idx`, a `UNIQUE NULLS NOT DISTINCT (tx_hash,
  log_index, event_type)` constraint. `nullsNotDistinct` was chosen exactly for
  your Solana rows where `log_index` is NULL, so no synthetic index value is
  needed. Note it is a UNIQUE *constraint*, not a unique index — drizzle 0.38
  only exposes `nullsNotDistinct()` on constraints — but `onConflictDoNothing()`
  targets it the same way. NOTE (corrected): the non-EVM `recordUnmatched`
  callers did NOT actually use `onConflictDoNothing()`, so a repeat catch-up
  pass raised 23505 and wedged the Solana cursor. Added at
  `solana-indexer/src/db-callbacks.ts`, `utxo-indexer/src/db-callbacks.ts` and
  `utxo-indexer/src/settlement.ts`.
- **#3** — acknowledged, nothing needed.
