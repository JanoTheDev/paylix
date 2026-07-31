# Indexers, Keepers & Mailer Audit

**Scope:** `packages/indexer`, `packages/solana-indexer`, `packages/utxo-indexer`, `packages/utxo-watcher`, `packages/mailer`
**Date:** 2026-07-31

## Summary

- The EVM indexer is the most mature of the three chains, but its cursor advances past chunks it failed to process and past logs whose handler threw, so a confirmed payment can be permanently lost with only a `console.error` as evidence.
- Two documented invariants are violated in code: `getHeadBlock` falls back to the raw unconfirmed head when the `INDEXER_BLOCK_TAG` RPC call fails, and `retryUnmatchedEvents` deletes the retained row *before* attempting the replay, so a throw drops the event.
- The Solana and UTXO indexers are not production-equivalent to the EVM path: neither creates `customers` rows, invoices, or webhooks; both write the wrong column type into `payments.customer_id`, and the resulting insert failure is swallowed while the checkout session is still marked `completed`.
- Both keepers treat "transaction landed" as "transaction succeeded" — the EVM keeper never inspects `receipt.status` and the Solana keeper never inspects the `err` from `confirmTransaction`, so a reverted charge resets the failure counter and silently skips a billing period.
- Money math is inconsistent: the EVM handlers do float division into `integer` cent columns (no `Math.round`, unlike the Solana path), the subscription fee hardcodes a 6-decimal divisor, and the UTXO path stores raw satoshis in the cents column.
- Webhook delivery has three independent defects: retries are signed with a different scheme than first delivery, `webhooks.livemode` is never filtered on, and rate-limited events are dropped without ever creating a delivery row.

## Finding Counts

| Severity | Count |
|---|---|
| Critical | 6 |
| High | 15 |
| Medium | 17 |
| Low | 6 |

## Findings

### IDX-01 — Non-EVM indexers write a text customer identifier into a uuid FK column

**Severity:** Critical
**File:** `packages/solana-indexer/src/db-callbacks.ts:90`, `packages/utxo-indexer/src/db-callbacks.ts:112`
**Problem:** `checkout_sessions.customer_id` is `text` (a merchant-supplied identifier — `packages/db/src/schema/checkout-sessions.ts:18`), while `payments.customer_id` is `uuid NOT NULL REFERENCES customers.id` (`packages/db/src/schema/payments.ts:14`). Both non-EVM callbacks pass `session.customerId` straight into `payments.customerId`. Unless the merchant happens to supply a UUID that already exists in `customers`, every insert fails on invalid uuid syntax or FK violation. The failure is caught and downgraded to `console.warn` (solana `:105`, utxo `:127`), and the code then marks the checkout session `completed` anyway (solana `:109`, utxo `:131`). Result: money received, session shows paid, no payment row, no alert. The EVM handler does this correctly — it upserts a `customers` row and uses `customer.id` (`packages/indexer/src/handlers.ts:212-228`).
**Fix:** Port the customer upsert from `handlers.ts:201-250` into both callback modules (or extract it into a shared helper), resolve to `customers.id`, and use that for `payments.customerId`. Do not mark the session `completed` unless the payment insert succeeded or failed with a genuine unique-violation (`23505`).
**Effort:** M

### IDX-02 — Block-tag failure silently falls back to the unconfirmed head

**Severity:** Critical
**File:** `packages/indexer/src/listener.ts:49`
**Problem:** When `INDEXER_BLOCK_TAG=safe|finalized` is set, `getHeadBlock` calls `client.getBlock({ blockTag })` inside a `try`, and the `catch {}` at `:49-51` returns `client.getBlockNumber()` — the raw `latest` head with **zero** confirmations. `CONFIRMATIONS` is not applied on this path. A single flaky RPC response therefore turns the most conservative configuration into the least safe one, silently and with no log line. This directly contradicts the documented invariant "Indexer never reads from the unsafe head."
**Fix:** On block-tag failure, log the error and either return the previous known head (skip the tick) or fall back to `latest - CONFIRMATIONS`, never bare `latest`. Same for the `??` fallback on `:48`.
**Effort:** S

### IDX-03 — Solana listener has no cursor, no backfill, and no restart recovery

**Severity:** Critical
**File:** `packages/solana-indexer/src/listener.ts:45`, `packages/solana-indexer/src/index.ts:66`
**Problem:** The Solana indexer's only event source is `connection.onLogs(...)` — a live WebSocket push subscription. There is no slot cursor persisted anywhere (no equivalent of `packages/indexer/src/cursor.ts`), no `getSignaturesForAddress` catch-up, and no backfill on boot. Every event emitted while the process is down, while the WebSocket is reconnecting, or before the subscription is installed is lost permanently with no record. The EVM indexer solves exactly this with `getLastBlock`/`setLastBlock` plus a backfill window.
**Fix:** Persist the last processed slot per program in `system_status` (reuse the `cursor_*` key convention). On boot and after every reconnect, page `getSignaturesForAddress` from the stored slot to the current one, run the decoded events through `onEvent`, then install the live subscription and advance the cursor from both paths.
**Effort:** L

### IDX-04 — UTXO payments store satoshis in the cents column

**Severity:** Critical
**File:** `packages/utxo-indexer/src/db-callbacks.ts:113`
**Problem:** `amount: Number(session.amount)` writes `checkout_sessions.amount` verbatim into `payments.amount`. For UTXO sessions that field holds satoshis — the same column is read as `expectedSats: BigInt(r.amount)` at `:72` of the same file. `payments.amount` is integer cents everywhere else in the system (`packages/db/src/schema/payments.ts:15`; see the documented invariant). A 0.001 BTC payment (100,000 sats) is recorded as $1,000.00 and flows into dashboards, invoices, refund caps, and the `checkKeeperFailureRate` denominator.
**Fix:** Convert satoshis to cents using the session's fiat price snapshot before insert, or add an explicit `amount_sats` column and stop reusing `amount`. Whichever is chosen, assert the unit at the boundary rather than relying on the column being polymorphic.
**Effort:** M

### IDX-05 — Cursor advances past chunks and logs that were never processed

**Severity:** Critical
**File:** `packages/indexer/src/listener.ts:282`, `packages/indexer/src/listener.ts:259`
**Problem:** Two separate paths permanently drop confirmed on-chain events. (1) In `processWindow`'s non-rate-limit `catch`, the comment "Genuine poisoned chunk — advance so we don't get stuck on it" is followed by `await setLastBlock(spec.key, chunkEnd)` at `:282` — the block range is marked processed even though `getLogs` never returned. A transient non-429 RPC error (timeout, 502, malformed response) silently skips a window of blocks forever. (2) Inside the log loop, a handler throw is caught and logged at `:260-265`, then execution falls through to `setLastBlock(chunkEnd)` at `:268`. A DB hiccup during `handlePaymentReceived` loses that payment with no unmatched-events row and no retry.
**Fix:** Do not advance the cursor on chunk failure — retry the chunk with backoff and stop the window (matching the rate-limit branch at `:271-276`). For per-log handler failures, either abort the chunk without advancing, or push the log into `unmatched_events` before continuing so the retry sweep can pick it up.
**Effort:** M

### IDX-06 — Unmatched-event retry deletes the retained row before replaying it

**Severity:** Critical
**File:** `packages/indexer/src/handlers.ts:1476`
**Problem:** For each of the three handled event types the code deletes the `unmatched_events` row first (`:1476`, `:1482`, `:1488`) and only then calls the handler. The inline comment claims this is safe "because txHash idempotency protects us," but that only holds if the handler runs far enough to call `recordUnmatched` itself. Any throw before that point — DB connection error, `symbolForTokenAddress` throwing on an unregistered token (`:81`), `buildInvoice` failing, a `products` row missing (`:306`) — is caught by the outer `catch` at `:1504` and merely logged. The row is already gone. This defeats the documented "unmatched events are retained, not dropped" invariant precisely in the failure case it exists for.
**Fix:** Do not delete up front. Mark the row as in-flight (bump `attempts`), replay, and delete only after the handler returns successfully. Have the handlers detect an existing in-flight row for the same `(txHash, logIndex)` instead of inserting a duplicate.
**Effort:** M

### IDX-07 — EVM keeper treats a reverted charge transaction as a success

**Severity:** High
**File:** `packages/indexer/src/keeper.ts:228`
**Problem:** `waitForTransactionReceipt` resolves for both successful and reverted transactions. Line `:228` logs `receipt.status` but nothing branches on it: the code unconditionally proceeds to `:230-238` and sets `chargeFailureCount: 0`, `lastChargeError: null`, `pastDueSince: null`. Combined with the optimistic `nextChargeDate` bump at `:170-173`, a charge that reverts on-chain (revoked allowance, insufficient USDC balance, contract paused) is recorded as a clean success, the dunning ladder resets, and the subscriber gets a free billing period. Nothing ever enters `past_due` via this path.
**Fix:** `if (receipt.status !== "success") throw new Error(...)` immediately after `:226` so the existing `catch` block runs the dunning classification, or replicate the failure handling inline.
**Effort:** S

### IDX-08 — Solana keeper ignores the confirmation error

**Severity:** High
**File:** `packages/solana-indexer/src/keeper.ts:167`
**Problem:** `await connection.confirmTransaction({...}, "confirmed")` returns `RpcResponseAndContext<SignatureResult>` where `value.err` is non-null for a transaction that landed but failed. `chargeOne` discards the return value entirely and returns the signature, so the caller at `:60-67` logs "charged", calls `onChargeSubmitted`, and increments the success counter. `onChargeFailed` and the `FAILURE_THRESHOLD` past-due logic in `keeper-callbacks.ts:97` are unreachable for on-chain reverts. Same defect class as IDX-07.
**Fix:** Capture the result and `throw` when `result.value.err` is set, including the error in the message so `onChargeFailed` records something actionable.
**Effort:** S

### IDX-09 — Transient Electrum errors are reported as reorgs and delete confirmed payments

**Severity:** High
**File:** `packages/utxo-watcher/src/electrum.ts:287`
**Problem:** `watcher.checkReorgs` is explicitly designed around a three-state contract — `undefined` means "transient lookup failure; retry next cycle" (`packages/utxo-watcher/src/watcher.ts:142`), `null` means reorged out. The Electrum implementation never honours it: the `catch` at `:286-289` returns `null` for *every* failure, including connection-closed, timeout, and server error, and `:284` also returns `null` when `getTipHeight()` yields 0. A single Electrum blip therefore drives `watcher.ts:143` down the reorg branch, which calls `onReorg`, which **deletes the payments row** (`packages/utxo-indexer/src/db-callbacks.ts:157-159`) and flips the session back to `active`. Confirmed, settled payments are destroyed by an RPC hiccup.
**Fix:** Return `undefined` from the `catch` and from the `!tip` branch; reserve `null` for an explicit "missing transaction"/no-blockhash response from the server. Widen the return type to `number | null | undefined` so the contract is enforced by the compiler.
**Effort:** S

### IDX-10 — Electrum client never fetches history on subscribe or resubscribe

**Severity:** High
**File:** `packages/utxo-watcher/src/electrum.ts:258`, `packages/utxo-watcher/src/electrum.ts:190`
**Problem:** `blockchain.scripthash.subscribe` returns the address's *current* status hash as its RPC result, but both the initial subscribe (`:258`) and the reconnect resubscribe (`:190`) `await` the request and throw the result away. Only subsequent push notifications trigger `refreshHistory`. Consequences: (a) a payment that arrived before the watcher process started is never detected until unrelated activity on the same address moves the status hash — i.e. never, since addresses are single-use; (b) any payment landing during a WebSocket outage is invisible after reconnect. Combined with the fact that `WatchedSession.firedFor` is in-memory only (`watcher.ts:93`), restarting the UTXO indexer means already-received funds are simply never credited.
**Fix:** After every successful `subscribe` call — initial and post-reconnect — invoke `refreshHistory(scripthash)` unconditionally so the current chain state is reconciled rather than assumed.
**Effort:** S

### IDX-11 — Webhook retries are signed with a different scheme than first delivery

**Severity:** High
**File:** `packages/indexer/src/webhook-dispatch.ts:221`
**Problem:** First delivery signs `t=<ts>,v1=HMAC(secret, "<ts>.<payload>")` (`:86-89`), with an explicit comment about replay-window validation. The retry path signs `sha256=HMAC(secret, payload)` — no timestamp prefix, no `t=`/`v1=` structure, different signed message. Any receiver implementing the documented verification will reject 100% of retried deliveries, meaning every webhook that fails once can never succeed. `retryFailedWebhooks` will burn all 5 attempts and give up.
**Fix:** Extract the signature construction into a single function and call it from both `attemptDelivery` and `retryFailedWebhooks`. Also note `:219` re-serializes `delivery.payload` from JSONB, so key ordering may differ from the original — sign the exact bytes that are sent, which the shared helper naturally enforces.
**Effort:** S

### IDX-12 — Webhook dispatch ignores `webhooks.livemode`

**Severity:** High
**File:** `packages/indexer/src/webhook-dispatch.ts:36`
**Problem:** The `webhooks` table has a `livemode` column (`packages/db/src/schema/webhooks.ts:11`) and `dispatchWebhooks` receives a `livemode` argument, but the query filters only on `organizationId` and `isActive`. The flag is used solely to populate the envelope (`:42`). Every merchant with both a test and a live endpoint registered receives live payment events on their test endpoint and vice versa. `dispatchSystemWebhook` (`:144-147`) has the same gap and additionally fans out across *all* organizations.
**Fix:** Add `eq(webhooks.livemode, livemode)` to the `where` in `dispatchWebhooks`. Decide explicitly whether `dispatchSystemWebhook` should be operator-scoped and filter accordingly.
**Effort:** S

### IDX-13 — On-chain amounts are float-divided into integer cent columns

**Severity:** High
**File:** `packages/indexer/src/handlers.ts:160`
**Problem:** `Number(args.amount) / 10 ** (paymentToken.decimals - 2)` produces a JS float with no rounding, and it is inserted straight into `payments.amount`, an `integer` column. The same unrounded pattern appears at `:255-261` (subtotal/tax), `:519`, `:700`, `:794-800`, and `:1058-1059`. Any on-chain amount not an exact multiple of 10^(decimals-2) — coupon-adjusted totals, tokens with different decimals, dust — yields a fractional value that Postgres rejects, throwing inside `db.transaction` and losing the payment (via IDX-05, permanently). The Solana path already does this correctly with `Math.round` (`packages/solana-indexer/src/db-callbacks.ts:84`), which confirms the EVM path is the outlier.
**Fix:** Wrap every cents conversion in `Math.round`, and factor the conversion into one exported helper used by all three indexers so the rule cannot drift again.
**Effort:** S

### IDX-14 — Subscription fee hardcodes a 6-decimal divisor

**Severity:** High
**File:** `packages/indexer/src/handlers.ts:269`
**Problem:** `fee: Number(args.fee) / 10_000` uses a literal divisor while the amount two lines earlier uses the registry-derived `centsDivisor = 10 ** (paymentToken.decimals - 2)` (`:255`). The two agree only for 6-decimal tokens. For an 18-decimal token the recorded fee is off by 12 orders of magnitude; for a 2-decimal token it is off by 4. The recurring handler gets this right (`:1059`), so the one-time path is inconsistent with its own sibling.
**Fix:** Replace the literal with `Math.round(Number(args.fee) / centsDivisor)`.
**Effort:** S

### IDX-15 — Rate-limited webhook events are dropped with no delivery row and no retry

**Severity:** High
**File:** `packages/indexer/src/webhook-dispatch.ts:46`
**Problem:** `isUrlRateLimited` gates delivery at 10/minute per URL, and on a hit the loop `continue`s *before* the `webhookDeliveries` insert at `:63`. The event is therefore never persisted at all — no row, no `nextRetryAt`, nothing for `retryFailedWebhooks` to find. A merchant with a burst of 11 payments in one minute silently loses the 11th webhook forever, and has no way to detect it. The same pattern repeats at `:160` in `dispatchSystemWebhook`.
**Fix:** Insert the delivery row with `status: "failed"` and `nextRetryAt: getNextRetryTime(0)` before skipping, so the retry sweep drains the backlog rather than discarding it.
**Effort:** S

### IDX-16 — Unmatched retry queue is LIFO, starving the oldest events

**Severity:** High
**File:** `packages/indexer/src/handlers.ts:1431`
**Problem:** `retryUnmatchedEvents` selects `.orderBy(desc(unmatchedEvents.createdAt)).limit(50)` — newest first. Once the queue exceeds 50 rows, the oldest entries are never selected again, because each 30-second pass re-reads only the newest 50. The comment at `:1436-1437` ("all slid past our ORDER BY window? Unreachable") assumes the opposite ordering. The `oldestAgeSeconds` metric and the `unmatched_retry_queue_deep` alert (`packages/indexer/src/alerts.ts:228`) will fire while the affected rows are provably unreachable.
**Fix:** Change to `asc(unmatchedEvents.createdAt)` so the queue drains FIFO.
**Effort:** S

### IDX-17 — EVM indexer has no shutdown handling and reports healthy after its poll loop dies

**Severity:** High
**File:** `packages/indexer/src/index.ts:61`, `packages/indexer/src/listener.ts:359`
**Problem:** There is no `process.on("SIGTERM"|"SIGINT")` anywhere in `packages/indexer` (the Solana and UTXO daemons both have one). A container stop kills the process mid-`writeContract`/mid-transaction with no drain. Separately, the live poll loop is fire-and-forget: `poll().catch(err => console.error(...))` at `listener.ts:359` logs and returns, leaving the process alive with no listener. The heartbeat (`index.ts:38-53`) keeps writing `indexer_heartbeat = "ok"` every 30 seconds regardless, so the dashboard reports green while no events are being indexed at all. `let stopped = false` at `listener.ts:330` is never assigned `true`, so there is not even a mechanism to stop it.
**Fix:** Add SIGTERM/SIGINT handlers that set `stopped = true`, wait for the in-flight keeper tick and poll pass, then exit. Make the poll loop's terminal `catch` either restart the loop with backoff or flip the heartbeat to a `degraded`/`error` value that the dashboard surfaces.
**Effort:** M

### IDX-18 — A failing `onPayment` callback loses the payment and rejects unhandled

**Severity:** High
**File:** `packages/utxo-watcher/src/watcher.ts:103`
**Problem:** In the subscription callback, `firedFor.add(hit.txid)` runs at `:100` *before* `onPayment` is awaited at `:103`, and the `finally` at `:111-115` unwatches the session regardless of outcome. If `onPayment` throws (DB down, FK violation — see IDX-01), the txid is already marked as fired, the address subscription is torn down, and the throw propagates out of an async callback invoked via `await cb({...})` inside `refreshHistory`, which itself is called as `void this.refreshHistory(...)` (`electrum.ts:165`) — an unhandled rejection. The payment is never retried and the process may terminate under Node's default rejection policy.
**Fix:** Move `firedFor.add` and the `unwatch` into the success path only; on failure log and leave the subscription active so the next status notification retries. Wrap the callback invocation so nothing escapes into an unhandled rejection.
**Effort:** M

### IDX-19 — `refreshHistory` rejections are unhandled

**Severity:** High
**File:** `packages/utxo-watcher/src/electrum.ts:165`
**Problem:** `void this.refreshHistory(scripthash)` is invoked from the synchronous frame handler with no `.catch`. `refreshHistory` itself has no `try`/`catch` and performs two awaited `request` calls (`:215`, `:223`) that reject on connection close (`handleClose` rejects all pending at `:175`) or on a server-side JSON-RPC error (`:157`). Every such rejection is an unhandled promise rejection, which terminates the process on modern Node — meaning a routine Electrum disconnect in the middle of a history fetch crash-loops the UTXO indexer.
**Fix:** Attach `.catch(err => console.error(...))` at the call site and wrap `refreshHistory`'s body so a failed fetch is retried on the next notification rather than escaping.
**Effort:** S

### IDX-20 — Trial converter counts an unconfirmed submission as success and can retry forever

**Severity:** High
**File:** `packages/indexer/src/trial-converter.ts:104`
**Problem:** `writeContract` resolves as soon as the transaction is accepted into the mempool. The converter never awaits a receipt, never checks status, and never stores the returned hash — it just stamps `trialConversionSubmittedAt` and increments `succeeded`. A transaction that lands and **reverts** therefore takes the success path: `trialConversionAttempts` is not incremented (only the `catch` at `:116` does that), so the ten-minute re-selection window at `:205-208` picks the row up again, and the `lt(trialConversionAttempts, MAX_TRIAL_CONVERSION_ATTEMPTS)` guard at `:204` never trips. The row is resubmitted every ten minutes indefinitely, burning relayer gas and never reaching `trial_conversion_failed`. Additionally, because no receipt is awaited, consecutive `writeContract` calls in the same tick share one relayer account with no explicit nonce management — under mempool lag this produces "nonce too low"/replacement failures that are then misclassified as `nonce_drift` (a terminal category, `trial-error-classifier.ts:26`) and permanently fail otherwise-valid trials.
**Fix:** Await `waitForTransactionReceipt`, treat `status !== "success"` as a failure so the dunning/attempt path runs, persist the tx hash on the row, and manage the relayer nonce explicitly (fetch once per tick and increment) to serialise submissions.
**Effort:** M

### IDX-21 — Solana and UTXO payment paths emit no webhooks, customers, or invoices

**Severity:** High
**File:** `packages/solana-indexer/src/db-callbacks.ts:67`, `packages/utxo-indexer/src/db-callbacks.ts:84`
**Problem:** The EVM `handlePaymentReceived` upserts a `customers` row, creates a `payments` row, builds and stores an invoice with sequential numbering, dispatches `payment.confirmed` and `invoice.issued`, records an audit entry, and sends the invoice email (`packages/indexer/src/handlers.ts:199-430`). Neither non-EVM callback module imports `dispatchWebhooks`, `buildInvoice`, `recordAudit`, or `customers` at all. A merchant accepting Solana or Bitcoin gets a payment row (when IDX-01 does not block it) and nothing else — no webhook fires, so any SDK integration built on `payment.confirmed` never learns the payment happened.
**Fix:** Extract the post-payment pipeline (customer upsert → payment → invoice → webhooks → audit → email) from `handlers.ts` into a shared, chain-agnostic module and call it from all three indexers. This also removes the triplicated session-matching and cents-conversion logic flagged in IDX-13 and IDX-27.
**Effort:** L

### IDX-22 — Keeper due-selection is a non-atomic select-then-update

**Severity:** Medium
**File:** `packages/indexer/src/keeper.ts:64`
**Problem:** `runKeeper` selects all `active` subscriptions with `nextChargeDate <= now` (`:64-72`), then per row issues an unconditional `UPDATE ... SET next_charge_date = tentative` (`:170-173`). There is no `WHERE next_charge_date = <original>` guard, no `FOR UPDATE SKIP LOCKED`, and no lease column. Two keeper instances (or an overlapping tick — see IDX-23) both read the same rows and both submit `chargeSubscription`, double-charging the subscriber. The `keeperRunning` flag in `index.ts:76` only protects against overlap within a single process. Additionally, a crash between the select and the bump silently skips a period, since the bump is not rolled back on process death.
**Fix:** Claim rows atomically — `UPDATE subscriptions SET next_charge_date = $tentative WHERE id = $id AND next_charge_date = $original RETURNING id` and skip the row when zero rows are returned. For multi-instance deploys add a `SELECT ... FOR UPDATE SKIP LOCKED` claim or an advisory lock (the pattern already used in `utxo-indexer/src/db-callbacks.ts:179`).
**Effort:** M

### IDX-23 — Unbounded receipt wait blocks every other keeper-scheduled job

**Severity:** Medium
**File:** `packages/indexer/src/keeper.ts:226`, `packages/indexer/src/index.ts:79`
**Problem:** `waitForTransactionReceipt` is called with no `timeout` and no `retryCount` inside a strictly sequential `for` loop over all due subscriptions. One stuck transaction blocks every remaining subscription in the batch. Because `scheduleKeeper` guards on `keeperRunning` (`index.ts:79-82`), it also blocks `sweepLongPastDue`, `runTrialConverterTick`, `runTrialReminderTick`, `runTrialStartedEmailTick`, and `runCheckoutRecoveryTick` — the entire background pipeline stalls on a single hung RPC call, and the heartbeat still reports `ok`.
**Fix:** Pass an explicit `timeout` to `waitForTransactionReceipt` and cap the per-tick batch size. Consider decoupling the trial/email ticks onto their own timer so a keeper stall cannot starve them.
**Effort:** S

### IDX-24 — Numeric and enum environment variables are unvalidated

**Severity:** Medium
**File:** `packages/indexer/src/config.ts:7`, `packages/indexer/src/listener.ts:38`, `packages/indexer/src/index.ts:68`, `packages/solana-indexer/src/index.ts:46`, `packages/utxo-indexer/src/index.ts:42`
**Problem:** Several values that must be explicit are taken on trust. `config.ts:7-8` uses `!` non-null assertions on `DATABASE_URL` and `KEEPER_PRIVATE_KEY`, so a missing value surfaces as an obscure downstream error rather than a startup failure. `listener.ts:38` does `BigInt(parseInt(env, 10))` — a non-numeric `INDEXER_CONFIRMATIONS` yields `BigInt(NaN)`, which throws at module load. `index.ts:68` parses `KEEPER_INTERVAL_MS` without a NaN check, and `setTimeout(fn, NaN)` fires immediately, producing a tight keeper loop. `utxo-indexer/src/index.ts:42-45` has the same NaN exposure for `UTXO_CONFIRMATIONS` and `UTXO_POLL_MS` — a NaN confirmation threshold makes `hit.confirmations < NaN` always false, so **every unconfirmed transaction is credited**. `solana-indexer/src/index.ts:46` casts `SOLANA_COMMITMENT` with `as "finalized" | "confirmed"` and passes it straight to `new Connection`, so `SOLANA_COMMITMENT=processed` silently opts into reading rollback-able state — the Solana analogue of the unsafe-head invariant.
**Fix:** Add a small validated-config module per package: required strings throw at boot with a clear message, numbers go through a `parsePositiveInt(name, default)` that rejects NaN, and enums are checked against a literal allowlist (as `requireNetworkKey` at `solana-indexer/src/index.ts:29` already does correctly).
**Effort:** S

### IDX-25 — Trial activation writes are not transactional

**Severity:** Medium
**File:** `packages/indexer/src/handlers.ts:502`
**Problem:** The non-trial branch of `handleSubscriptionCreated` wraps customer, payment, subscription, invoice, and session updates in `db.transaction` (`:738`). The trial match-and-activate branch does not: `:502` flips the row to `active`, `:521` inserts the payment, `:540` links `lastPaymentId`, and `:608-635` writes the invoice — four independent statements. A crash or DB error between them leaves a subscription marked `active` with no payment row and no invoice, and since `:461-475` short-circuits on an existing `onChainId`, the event will never be reprocessed to repair it.
**Fix:** Wrap the trial branch in `db.transaction` the same way the sibling branch is, keeping webhook dispatch and email sending outside the transaction.
**Effort:** M

### IDX-26 — `unmatched_events` has no dedup constraint and no attempt ceiling

**Severity:** Medium
**File:** `packages/indexer/src/handlers.ts:1499`, `packages/db/src/schema/unmatched-events.ts:3`
**Problem:** The table has no unique index on `(tx_hash, log_index, event_type)`, so every replay of the same log inserts another row — the queue grows without bound and the `unmatched_retry_queue_deep` alert fires on self-inflicted duplicates. The `attempts` column is only ever incremented for unknown event types (`:1501`) and rows with no stored ctx (`:1466`); the three real handler paths never bump it. There is consequently no ceiling, no backoff, and no dead-letter state — a genuinely unmatchable event (e.g. a session deleted by an org cascade) is retried every 30 seconds forever.
**Fix:** Add a unique index on `(tx_hash, log_index, event_type)` and use `onConflictDoNothing` in `recordUnmatched`. Increment `attempts` on every retry, apply exponential backoff via a `next_attempt_at` column, and move rows past a threshold to a terminal `abandoned` state that raises an operator alert instead of spinning.
**Effort:** M

### IDX-27 — Checkout-session matching is capped at 200 candidate rows

**Severity:** Medium
**File:** `packages/indexer/src/handlers.ts:179`, `packages/indexer/src/handlers.ts:719`, `packages/solana-indexer/src/db-callbacks.ts:60`
**Problem:** Matching an on-chain event to a session works by loading the 200 most recent open sessions and brute-force hashing each `session.id` until one matches the event's `customerId`. A merchant with more than 200 concurrently open `viewed`/`active` sessions — trivial for a busy checkout page or after a burst of abandoned sessions — will not find the match, so a valid payment is diverted into the unmatched queue, and the retry pass re-runs the identical bounded scan and fails identically. The Solana variant is worse: it does not filter by merchant at all (`:52-58`), so the 200 rows are shared across every merchant on the instance.
**Fix:** Store `keccak256(session.id)` in an indexed column on `checkout_sessions` at creation time and look the session up by equality instead of scanning. Failing that, filter by merchant *and* paginate rather than truncating.
**Effort:** M

### IDX-28 — Solana due query is unbounded, N+1 on RPC, and never resets the failure counter

**Severity:** Medium
**File:** `packages/solana-indexer/src/keeper-callbacks.ts:37`, `packages/solana-indexer/src/keeper-callbacks.ts:91`
**Problem:** `dueSubscriptions` selects with no `.limit()`, then for each candidate performs a sequential `fetchSubscriptionAccount` plus two `getAssociatedTokenAddress` calls (`:55-62`) before returning — a backlog produces an unbounded serial RPC storm on every 60-second tick. Separately, `chargeFailureCount` is incremented in `onChargeFailed` (`:91`) but never reset anywhere: `onChargeSubmitted` (`:76-81`) only stamps `lastChargeAttemptAt`. After three lifetime failures the counter stays at or above `FAILURE_THRESHOLD` forever, so the next single failure — years later — immediately flips the subscription to `past_due`. The EVM keeper resets it correctly (`packages/indexer/src/keeper.ts:233`).
**Fix:** Add a `.limit()` and batch the account fetches with `getMultipleAccountsInfo`. Reset `chargeFailureCount: 0`, `lastChargeError: null`, `pastDueSince: null` in `onChargeSubmitted`.
**Effort:** M

### IDX-29 — Trial converter hardcodes USDC regardless of the stored price snapshot

**Severity:** Medium
**File:** `packages/indexer/src/trial-converter.ts:156`
**Problem:** `resolveUsdcAddressForNetwork` calls `getToken(networkKey, "USDC")` with a literal symbol, and the result is passed as the `token` field of the permit tuple (`:89`). The subscription's actual token is available on the row it ignores — `sig.priceSnapshot.tokenSymbol` is read for the network key on the very same line. A trial priced in USDT or PYUSD is submitted with the USDC mint, which either reverts (the permit signature was produced for a different token contract) or, worse, transfers the wrong asset. The function name and the `NetworkKey` cast at `:156` also bypass validation of the network key itself.
**Fix:** Resolve the token from `sig.priceSnapshot.tokenSymbol`, and throw with a clear message if the symbol is not registered for that network.
**Effort:** S

### IDX-30 — Email normalization is triplicated and the disposable-domain list has drifted

**Severity:** Medium
**File:** `packages/indexer/src/abandonment.ts:12`, `packages/indexer/src/handlers.ts:43`
**Problem:** `normalizeEmail` exists verbatim in at least three places — `handlers.ts:43-55`, `abandonment.ts:21-33`, and `apps/web/lib/email-normalize.ts` (referenced by the "if you change one, change the other" comment at `handlers.ts:39-42`). More damaging, `abandonment.ts:12-19` claims its `DISPOSABLE_DOMAINS` set is "shared with the checkout path … Small duplication, low drift risk" but contains **6** domains while the documented checkout blocklist has **148**. The abandonment-recovery mailer therefore emails 142 disposable-domain classes that checkout itself refuses, undermining the trial anti-abuse posture.
**Fix:** Move `normalizeEmail` and the disposable-domain list into a shared workspace package (e.g. `@paylix/config`) that both `apps/web` and `packages/indexer` import. Delete all three copies.
**Effort:** S

### IDX-31 — Mailer caches a rejected driver promise and silently no-ops when unconfigured

**Severity:** Medium
**File:** `packages/mailer/src/index.ts:16`, `packages/mailer/src/select.ts:17`
**Problem:** `sendMail` memoizes `driverPromise = selectDriver()` and never clears it. `selectDriver` *throws* for a misconfigured driver (`select.ts:22`, `:34`, `:47`), so the first call caches a permanently rejected promise: every subsequent `sendMail` rejects rather than returning `{ ok: false }`, breaking the documented `SendMailResult` contract. Callers vary in how they handle this — `invoices/send-email.ts:53` has no `try`/`catch` and lets the throw escape into the payment handler. Separately, an unset `MAIL_DRIVER` returns `noopDriver()` (`select.ts:17`) whose every send returns `ok: false`; combined with the `.catch(console.error)` at most call sites, an operator who forgot to configure mail gets zero emails and zero visible errors.
**Fix:** Have `selectDriver` return a driver whose `send` reports the configuration error instead of throwing, or reset `driverPromise = null` on rejection so the next call retries. Log a loud startup warning when `MAIL_DRIVER` is unset rather than degrading silently.
**Effort:** S

### IDX-32 — Electrum client has no request timeout and races on connect

**Severity:** Medium
**File:** `packages/utxo-watcher/src/electrum.ts:197`, `packages/utxo-watcher/src/electrum.ts:131`
**Problem:** `request()` registers a pending promise keyed by id and resolves it only from an inbound frame; there is no timeout. If the server accepts the frame and never answers, the promise never settles, the `pending` map grows unbounded, and `refreshHistory` hangs mid-loop holding the callback. Only a socket close rejects pending entries (`:175`). Separately, `ensureConnected` at `:132` only returns the cached socket when `readyState === OPEN`; a call made while the socket is still `CONNECTING` constructs a **second** WebSocket and overwrites `this.ws`, orphaning the first with its handlers still attached. `close()` at `:292` also leaves `subscriptions` populated and `pending` un-rejected.
**Fix:** Add a per-request timeout that deletes the pending entry and rejects. Track an in-flight connect promise so concurrent `ensureConnected` callers share one socket. Clear `subscriptions` and reject `pending` in `close()`.
**Effort:** M

### IDX-33 — Underpayments are silently ignored with no record

**Severity:** Medium
**File:** `packages/utxo-watcher/src/watcher.ts:98`
**Problem:** `if (hit.valueSats < session.expectedSats) return;` discards the hit entirely — no log, no partial-credit tracking, no callback. The module header claims the watcher "accumulates credits per session," but no accumulation exists; each transaction is evaluated in isolation against the full expected amount. A buyer who underpays by one satoshi (or pays in two transactions) has their funds sit at a single-use derived address while the session expires as unpaid, with nothing in the database or logs indicating why.
**Fix:** At minimum, log the shortfall and surface it via a callback so the merchant can be notified. Better: accumulate confirmed value per session across transactions and fire `onPayment` when the running total crosses `expectedSats`.
**Effort:** M

### IDX-34 — Borsh decoder has no bounds checking and throws outside the listener's guard

**Severity:** Medium
**File:** `packages/solana-indexer/src/decoder.ts:86`, `packages/solana-indexer/src/listener.ts:49`
**Problem:** `BorshReader.u64`/`i64`/`u8` call `readBigUInt64LE`/`readUInt8` with no length check (`decoder.ts:85-104`); `pubkey`/`bytes32` silently return short slices past the end. A truncated or version-skewed `Program data:` payload whose first 8 bytes match a known discriminator throws a `RangeError` out of `decodeProgramData`. That call happens in `parseLogs`, which is evaluated in the `for (const event of parseLogs(logs.logs))` header at `listener.ts:49` — **outside** the `try` at `:50-59`. The throw escapes the async `onLogs` callback as an unhandled rejection.
**Fix:** Validate remaining length in each `BorshReader` primitive and throw a typed decode error; catch it in `decodeProgramData` and return `null`. Move `parseLogs` inside the `try` regardless.
**Effort:** S

### IDX-35 — Webhook rate-limit map grows without eviction

**Severity:** Medium
**File:** `packages/indexer/src/webhook-dispatch.ts:12`
**Problem:** `urlDeliveryCounts` accumulates one entry per distinct webhook URL and nothing ever deletes them. Expired windows are overwritten in place (`:17-20`) but the key itself is retained forever. In a long-running self-hosted instance with many merchants rotating endpoints this is a slow unbounded memory leak in a process that is expected to run for months.
**Fix:** Sweep entries whose `resetAt` is well past on a periodic timer, or replace with a bounded LRU.
**Effort:** S

### IDX-36 — `MAX_BACKFILL_BLOCKS` silently skips blocks after downtime

**Severity:** Medium
**File:** `packages/indexer/src/listener.ts:301`
**Problem:** On startup, if the stored cursor is further than `MAX_BACKFILL_BLOCKS` (default 5000, ~2.8 hours on Base) behind the head, `fromBlock` is reset to `currentBlock - MAX_BACKFILL_BLOCKS` and everything in between is skipped. The only signal is a `console.log` at `:303-305` phrased as a routine capping message. Any downtime longer than ~3 hours therefore permanently loses payments with no unmatched-events entry, no alert, and no record of which range was skipped.
**Fix:** Record the skipped range in `system_status` (or `unmatched_events`), emit a `system.*` webhook, and mark the heartbeat degraded so an operator can decide whether to run a manual backfill instead of discovering the gap from a customer complaint.
**Effort:** S

### IDX-37 — SMTP driver does not require TLS on submission ports

**Severity:** Medium
**File:** `packages/mailer/src/drivers/smtp.ts:17`
**Problem:** `secure: cfg.secure ?? cfg.port === 465` means any port other than 465 — notably the standard submission port 587 — connects with `secure: false`. Nodemailer will then attempt STARTTLS opportunistically but does not require it, because `requireTLS` is not set. Against a server that does not advertise STARTTLS (or an active downgrade), `SMTP_USER`/`SMTP_PASS` are transmitted in plaintext.
**Fix:** Set `requireTLS: true` whenever `secure` is false, and let operators opt out explicitly via an env flag if they are on a trusted loopback relay.
**Effort:** S

### IDX-38 — Webhook URL validation is vulnerable to DNS rebinding and misses address forms

**Severity:** Medium
**File:** `packages/indexer/src/url-safety.ts:43`
**Problem:** `validateWebhookUrl` resolves the hostname with `lookup()` and checks the single returned address, then `attemptDelivery` performs a completely independent `fetch` that re-resolves — a classic TOCTOU that a rebinding DNS record defeats. `lookup()` also returns only one address, so a host with both a public and a private record can pass. The blocklist at `:3-14` omits IPv4-mapped IPv6 (`::ffff:127.0.0.1`), CGNAT `100.64.0.0/10`, and `192.0.0.0/24`. Finally, outside production (`:39`, `:45`) every private address is explicitly allowed, so a staging deployment without `NODE_ENV=production` has SSRF protection fully disabled.
**Fix:** Resolve all addresses (`dns.resolve4`/`resolve6`) and reject if any is blocked; normalize IPv4-mapped IPv6 before matching; add the missing ranges. Pin the validated IP into the request (custom agent/`lookup`) so validation and connection target the same address.
**Effort:** M

### IDX-39 — Redundant dynamic imports of an already-static dependency

**Severity:** Low
**File:** `packages/indexer/src/keeper.ts:88`, `packages/indexer/src/keeper.ts:128`
**Problem:** `dispatchWebhooks` is imported statically at `:15`, yet both the gift-expiry and scheduled-cancel branches re-import it with `const { dispatchWebhooks } = await import("./webhook-dispatch")`, shadowing the module-scope binding. This adds an await per iteration and reads as though a circular-import workaround is required when none is.
**Fix:** Delete both dynamic imports and use the static binding.
**Effort:** S

### IDX-40 — Dead code, unreachable branches, and missing build/lint scripts

**Severity:** Low
**File:** `packages/indexer/src/listener.ts:330`, `packages/indexer/src/alerts.ts:175`, `packages/indexer/src/keeper.ts:267`
**Problem:** `let stopped = false` (`listener.ts:330`) is read at `:354` but never assigned `true` — the loop cannot be stopped. `void eqOp;` (`alerts.ts:175`) is a leftover to silence an unused destructured import that should simply not be destructured (`:161`). `classifyDunningOutcome` is always called with `hoursPastDue: 0` (`keeper.ts:248`), making the `"cancel"` case at `:266-270` structurally unreachable, as its own comment concedes. Separately, none of the five in-scope packages defines a `lint` script and only `mailer` defines a `build` (`tsc --noEmit`), so `turbo lint` and `turbo build` typecheck none of the indexer code.
**Fix:** Remove the dead bindings, drop the unreachable case (or pass a real `hoursPastDue`), and add `"build": "tsc --noEmit"` plus a `lint` script to the four packages lacking them so CI actually typechecks them.
**Effort:** S

### IDX-41 — Idempotency pre-check ignores `chain`, diverging from the unique index

**Severity:** Low
**File:** `packages/indexer/src/handlers.ts:147`, `packages/indexer/src/handlers.ts:1049`
**Problem:** The duplicate-payment guards query `eq(payments.txHash, log.transactionHash)` with no `chain` predicate, while the backing constraint is `uniqueIndex("payments_chain_tx_idx").on(chain, txHash)` (`packages/db/src/schema/payments.ts:35`). The check is therefore stricter than the constraint in one direction (a legitimate same-hash payment on a different chain is skipped) and, because the index is on `(chain, txHash)` only, a single transaction emitting two `PaymentReceived` logs for different sessions can never store both — the second is silently discarded by the pre-check and would be rejected by the index anyway.
**Fix:** Add `eq(payments.chain, ...)` to both pre-checks. If batched payments are a supported flow, extend the column set and unique index to include `log_index`.
**Effort:** S

### IDX-42 — Errors swallowed with no logging

**Severity:** Low
**File:** `packages/indexer/src/webhook-dispatch.ts:112`, `packages/indexer/src/webhook-dispatch.ts:257`, `packages/utxo-watcher/src/watcher.ts:148`
**Problem:** `attemptDelivery`'s `catch (error)` binds the error and never references it — the delivery is marked failed with no diagnostic. `retryFailedWebhooks` uses a bare `catch {}` at `:257`. `watcher.checkReorgs` has an empty `catch {}` at `:148-150` *after* already deleting the reorg watch at `:145`, so a failed `onReorg` callback is neither logged nor retried, leaving a payment row for an orphaned transaction in place permanently.
**Fix:** Log the error in all three places with enough context (delivery id / session id) to trace. In `checkReorgs`, delete the watch only after the callback succeeds.
**Effort:** S

### IDX-43 — Template renderer performs no HTML escaping

**Severity:** Low
**File:** `packages/mailer/src/render.ts:7`
**Problem:** `renderString` substitutes `{{ key }}` with the raw variable value and no escaping. It is exported from the package root (`index.ts:22`) and consumed by `apps/web/lib/auth.ts:61` to build invitation email HTML. Any variable carrying user-controlled text (names, organization names) can inject arbitrary markup into the outgoing email. `renderTemplate` additionally reads a caller-supplied path with `readFileSync` and no containment.
**Fix:** HTML-escape substituted values by default and expose an explicit raw-insert escape hatch for values known to be safe markup.
**Effort:** S

### IDX-44 — Solana shutdown abandons an in-flight charge

**Severity:** Low
**File:** `packages/solana-indexer/src/index.ts:109`, `packages/solana-indexer/src/keeper.ts:92`
**Problem:** The SIGINT/SIGTERM handlers call `shutdown()` and then `process.exit(0)` as soon as it resolves. `keeper.stop()` sets `stopped = true` and clears the pending timer, but does not await an executing `tick()` — the `stopped` flag is only checked at the top of `tick` (`:49`), not between charges. A shutdown landing between `sendTransaction` and `confirmTransaction` exits with the transaction in flight and `onChargeSubmitted` never called, so `lastChargeAttemptAt` is not stamped and the next boot re-selects the subscription after the 5-minute debounce.
**Fix:** Track the in-flight tick promise and await it in `stop()`; check `stopped` between iterations of the charge loop so shutdown drains rather than truncates.
**Effort:** S

## Quick Wins

- **IDX-02** — one-line change to stop falling back to the unconfirmed head.
- **IDX-07** / **IDX-08** — add a status/err check after the receipt wait in both keepers.
- **IDX-09** — return `undefined` instead of `null` for transient Electrum failures; stops false reorgs deleting payments.
- **IDX-10** — call `refreshHistory` after every subscribe; recovers payments missed across restarts.
- **IDX-11** — extract one signing helper and use it in both delivery paths.
- **IDX-12** — add `eq(webhooks.livemode, livemode)` to the dispatch query.
- **IDX-14** — replace the hardcoded `10_000` with the already-computed `centsDivisor`.
- **IDX-16** — flip `desc` to `asc` in the unmatched retry query.
- **IDX-39** / **IDX-40** — delete redundant dynamic imports, dead bindings, and the unreachable dunning case.
