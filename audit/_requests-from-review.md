# Cross-agent requests raised by reviewers

Items a reviewer surfaced that belong to a different agent than the one reviewed.
Owner-of-record: the orchestrator applies or delegates these.

## R-01 — Three subscription admin routes ignore `Idempotency-Key`

**Raised by:** SDK reviewer
**Owner:** the `apps/web/app/api/**` agent
**Severity:** High (double-charge / ledger corruption)

`apps/web/lib/idempotency.ts` exists and 13 of 16 SDK POST routes honour it. These three do not:

- `apps/web/app/api/subscriptions/[id]/comp-charge`
- `apps/web/app/api/subscriptions/[id]/extend-trial`
- `apps/web/app/api/subscriptions/[id]/reschedule`

Two are accumulative. Failure sequence: the SDK sends `compCharge()`, the route succeeds, the
response is lost to a 504 or the SDK's 30s timeout, the SDK retries, and the route inserts a second
amount-0 `payments` row and advances `next_charge_date` by a second interval — two free billing
periods. `extendTrial(id, 7)` becomes 14 free days the same way.

**Fix:** wrap all three with `withIdempotency`, matching the pattern the other 13 routes use.

**Interim mitigation already applied:** the SDK agent is making these three methods opt out of
retry, so the SDK cannot trigger it. That does not protect direct API callers — the route fix is
still required.

## R-02 — Contract ABI change breaks three off-chain call sites

**Raised by:** contracts reviewer
**Severity:** Critical *at deploy time* (not at commit time — current code matches the currently
deployed contracts; it breaks the moment the new contracts are deployed)

The contracts agent added `maxFeeBps` to `PaymentIntent`, `SubscriptionIntent` and
`SubscriptionIntentDiscount`, changed `addSubscriptionBackupPayer` to take a consent signature,
and renumbered the `Status` enum. Three off-chain callers were correctly left untouched by that
agent and must be updated in the same commit as the redeploy:

1. `apps/web/app/checkout/[sessionId]/checkout-client.tsx:570,710,1008,1048` — the EIP-712 typed-data
   arrays omit `maxFeeBps`. Every gasless checkout reverts with "Invalid intent signature".
   Add `{name:"maxFeeBps",type:"uint256"}` in the same position as the on-chain typehash and thread
   the value through `apps/web/app/api/checkout/[id]/relay/route.ts:710,735`.
   **Owner:** the `apps/web/app/**` agent, with the relay half owned by the `app/api/**` agent.
2. `apps/web/app/api/portal/subscriptions/[id]/backup-payer/route.ts:90-102` — calls the old 2-arg
   form. Every add-backup request reverts on ABI decode. Needs the backup wallet's
   `BackupPayerConsent` signature collected and passed as a third argument.
   **Owner:** the `app/api/**` agent, plus UI to collect the signature.
3. `packages/indexer/src/trial-converter.ts:121` — replays signatures stored before the upgrade.
   Those were signed over the OLD `SubscriptionIntent` typehash and can never verify against the new
   contract, so every pending trial becomes unconvertible. Needs a cutover plan: re-sign, or fail
   open trials at the boundary. **Owner:** the `packages/indexer` agent.

Also from `apps/web/lib/contracts.ts` — the inline ABIs for `createPaymentWithPermit`,
`createPaymentWithPermit2`, `createPaymentWithDaiPermit`, `createSubscriptionWithPermit`,
`createSubscriptionWithPermitDiscount` and `createSubscriptionWithPermit2` all need `maxFeeBps`,
and the intent deadline must equal the permit deadline. **Owner:** the `apps/web/lib/**` agent.

**Sequencing:** this whole set must land together with the redeploy, not before it. Deploying the
contracts without these changes breaks checkout; landing these changes without deploying breaks it
equally. Treat as one atomic change.

