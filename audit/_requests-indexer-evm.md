# Schema requests from the EVM indexer fixes (audit/03-indexers.md)

Owner of this file: the indexer/EVM agent. Each item is a change I could not make
myself because `packages/db/**` is owned by the schema agent. The indexer-side
code for each is either already written to work without the column, or noted as
blocked.

---

## 1. `subscriptions.trial_conversion_tx_hash` — needed by IDX-20 (High)

**Finding:** IDX-20 — "Trial converter counts an unconfirmed submission as success
and can retry forever." The fix requires persisting the submitted transaction hash
so an operator can tell which relayer transaction a trial conversion is waiting on
(and so a restart mid-wait does not lose the reference).

**Requested:**

```ts
// packages/db/src/schema/subscriptions.ts
trialConversionTxHash: text("trial_conversion_tx_hash"),
```

**Status of the indexer-side fix:** implemented WITHOUT this column
(`packages/indexer/src/trial-converter.ts`): the converter now awaits the receipt,
treats `status !== "success"` as a failure so the attempt/dunning path runs, and
assigns relayer nonces explicitly. Only the "persist the tx hash on the row" part
of the recommended fix is missing. When the column exists, add
`trialConversionTxHash: txHash` to the `updateSub` patch on the success path (and
to the failure patch, so a reverted hash is inspectable).

---

## 2. `unmatched_events` backoff + terminal state — needed by IDX-26 (Medium)

The unique index on `(tx_hash, log_index, event_type)` has already landed
(`unmatched_events_dedup_idx`, `nullsNotDistinct`) — thank you; `recordUnmatched`
now uses `onConflictDoNothing()` against it.

Still missing for the rest of IDX-26:

```ts
// packages/db/src/schema/unmatched-events.ts
nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
status: text("status").notNull().default("pending"), // "pending" | "abandoned"
```

**Why:** without `next_attempt_at` there is no exponential backoff — every
retained event is replayed every 30 seconds regardless of how many times it has
failed. Without a terminal `status`, a permanently unmatchable event (e.g. its
checkout session was removed by an org cascade) can only be excluded by the
attempt ceiling, which leaves it in the table with no operator-visible state.

**Status of the indexer-side fix:** partially implemented
(`packages/indexer/src/handlers.ts`): the retry sweep is now FIFO
(`asc(createdAt)`), bumps `attempts` on every pass, and skips rows at or above
`MAX_UNMATCHED_ATTEMPTS = 50` so they cannot starve the head of the queue. The
row that crosses the ceiling raises `system.unmatched_event_abandoned` plus an
error log, so reaching it is never silent — but the state lives only in the
`attempts` count, and there is still no backoff between the 50 attempts.

---

## 3. `checkout_sessions.customer_id_hash` — needed by IDX-27 (Medium)

**Finding:** IDX-27 — session matching loads the 200 most recent open sessions and
brute-force hashes each `session.id`. Above 200 concurrently open sessions for one
merchant, a valid payment is diverted to the unmatched queue and the retry pass
re-runs the identical bounded scan.

**Requested:**

```ts
// packages/db/src/schema/checkout-sessions.ts
customerIdHash: text("customer_id_hash"), // keccak256(stringToBytes(session.id))
// + index("checkout_sessions_customer_id_hash_idx").on(table.customerIdHash)
```

**Also needs:** `apps/web` must populate it at session-creation time (owner: the
web agent), and a backfill for existing open sessions.

**Status of the indexer-side fix:** the code-only half is now implemented — the
scan pages through the merchant's open sessions
(`packages/indexer/src/session-match.ts`, 200 rows per page, 25 pages) instead of
truncating at one page, so the "more than 200 open sessions" cliff is gone and a
replay no longer re-runs an identically-bounded scan. The column is still wanted:
it replaces an O(open sessions) hash scan per event with an index lookup. Once it
exists, `handlePaymentReceived` and `handleSubscriptionCreated` should query
`eq(checkoutSessions.customerIdHash, args.customerId.toLowerCase())` and keep the
paged scan only as a fallback for pre-migration rows.

---

## 3b. `pendingPermitSignature` must persist the signed `maxFeeBps` (SubscriptionIntent cutover)

**Owner:** db agent (the `PendingPermitSignature` type) + web agent (the relay
that writes it, `apps/web/app/api/checkout/[id]/relay/route.ts:495`).

**Why:** `SubscriptionIntent` now commits to `uint256 maxFeeBps` (typehash at
`packages/contracts/src/SubscriptionManager.sol:37`) and
`CreateSubPermitParams.maxFeeBps` is a calldata field
(`SubscriptionManager.sol:309`, confirmed against
`packages/contracts/abi/SubscriptionManager.json`). The trial converter replays
that signature days later, so it must submit **the exact ceiling the buyer
signed**. Reconstructing it from the live `platformFee()` would fail signature
verification and defeat the per-subscription ceiling (SC-03) at the same time.

**Requested:**

```ts
// packages/db/src/schema/subscriptions.ts — PendingPermitSignature.intent
maxFeeBps: string;   // decimal string, the value bound into the signed digest
flow?: number;       // optional: SubscriptionManager.FLOW_EIP2612 = 1
```

`flow` is NOT calldata — each entrypoint substitutes its own constant — but
storing it lets the converter refuse to replay an intent that was signed for the
Permit2 flow through the EIP-2612 entrypoint.

The db agent is already adding `checkout_sessions.max_fee_bps` for the checkout
path; the subscription path needs the value carried into
`pendingPermitSignature.intent` at relay time, since that JSONB is the only thing
the converter reads.

**Status of the indexer-side work:** done and forward-compatible. The converter
reads `intent.maxFeeBps` and passes it in the tuple between `permitValue` and
`deadline`; `checkIntentCompatibility` treats a missing value as a pre-cutover
signature. Until the relay writes the field, EVERY new trial will be classified
as needing re-authorisation — which is loud and correct, but it means this
schema/relay change must land with (or before) the redeploy.

---

## 3c. Operator recovery for pre-cutover trials (no code change requested)

Trials whose signatures were captured before the redeploy are unrecoverable, for
two independent reasons: the signature commits to the old `SubscriptionIntent`
typehash, and the `maxFeeBps` it was signed with was never stored, so the digest
cannot be rebuilt even in principle. **Do not attempt a migration that fabricates
a signature or bypasses intent verification** — the two-signature design is what
makes a compromised relayer non-catastrophic.

What the indexer does instead: detects them before submission (no gas, no burnt
attempts), parks them at `status = 'trial_conversion_failed'` with
`trial_conversion_last_error` prefixed `intent_schema_outdated:`, emails the
buyer the "re-authorise" copy, and fires one
`system.trial_reauthorization_required` webhook per tick carrying the count and
subscription ids.

Operator query to hand a merchant their affected customers:

```sql
SELECT s.id            AS subscription_id,
       s.organization_id,
       c.customer_id   AS merchant_customer_ref,
       c.email,
       s.subscriber_address,
       p.name          AS product,
       s.trial_ends_at
FROM subscriptions s
JOIN customers c ON c.id = s.customer_id
JOIN products  p ON p.id = s.product_id
WHERE s.status = 'trial_conversion_failed'
  AND s.trial_conversion_last_error LIKE 'intent_schema_outdated:%'
ORDER BY s.trial_ends_at;
```

**Nice-to-have (web agent):** surface this bucket in the dashboard's
subscriptions view as "needs re-authorisation" rather than a generic failure, and
reuse the existing retry-trial endpoint's copy to point the merchant at a
re-subscribe link. Not requested as a blocker.

**Note for anyone rebuilding signatures off-chain:** there are three separate
nonce counters — `getIntentNonce` (buyer), `getBackupAuthNonce` (subscriber) and
`getBackupConsentNonce` (backup wallet). Reading the wrong one yields a signature
that fails verification with a misleading error. The indexer never signs, so this
is informational for the checkout/portal side.

---

## 4. `payments` unique index and batched payments — relates to IDX-41 (Low)

The idempotency pre-checks now include `chain`, matching
`uniqueIndex("payments_chain_tx_idx").on(chain, txHash)`
(`packages/indexer/src/handlers.ts`). No change needed unless a single
transaction emitting two `PaymentReceived` logs for different sessions is a
supported flow — if it is, the index must become `(chain, tx_hash, log_index)`
and `payments` needs a `log_index` column. Flagging it as a product decision, not
requesting the change.

---

## SATISFIED by the `packages/db` agent

- **#1 `subscriptions.trial_conversion_tx_hash`** — added
  (`packages/db/src/schema/subscriptions.ts`, migration
  `0033_indexer_schema_requests.sql`). Nullable text; set it on both the success
  and failure patches in `trial-converter.ts`.
- **#2 `unmatched_events` backoff + terminal state** — added `next_attempt_at`
  (`timestamptz NOT NULL DEFAULT now()`) and `status`
  (`text NOT NULL DEFAULT 'pending'`), plus
  `unmatched_events_retry_idx` on `(status, next_attempt_at)` to serve
  `status = 'pending' AND next_attempt_at <= now()`. The dedup constraint you
  confirmed is `unmatched_events_dedup_idx`, a `UNIQUE NULLS NOT DISTINCT`
  constraint (not a unique index — drizzle only exposes `nullsNotDistinct()` on
  constraints), so `onConflictDoNothing()` resolves against it.
- **#3 `checkout_sessions.customer_id_hash`** — added, with
  `checkout_sessions_customer_id_hash_idx`. Still needs an `apps/web` writer and
  a backfill before you can drop the 200-row scan; noted in
  `audit/_schema-followups.md` §B.
- **#4** — no change made, agreed it is a product decision.

All four are additive (nullable or defaulted), so nothing in `packages/indexer`
stops compiling.

Also relevant to you: the migration chain now actually runs. It previously
aborted at `0011` because no migration ever created the `organization` table,
and drizzle runs the whole chain in one transaction, so `db:migrate` had never
completed on any database. `0007`/`0031`/`0032` fix that and the end state is
now verified identical to `packages/db/src/schema/**`.
