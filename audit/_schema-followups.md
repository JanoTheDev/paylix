# Schema follow-ups — call-site changes the schema agent could not make

Written by the `packages/db` / `packages/config` agent while fixing the `DB-`
findings in `audit/05-sdk-db.md`. Everything below is a change **outside**
`packages/db/**`, so it must be applied by the owning agent.

Format: `file:line — what must change`.

---

## A. Required — a schema change already landed and these call sites must follow

### A1. Refund duplicate guard must include the chain (DB-15)

`refunds.tx_hash` was globally unique. It is now `UNIQUE (network_key, tx_hash)`
(`refunds_network_tx_hash_idx`), because a tx hash is only unique per chain and
the old index rejected a legitimate refund on chain B that collided with one on
chain A. The duplicate guard still exists — it is just per-chain now.

- `apps/web/app/api/payments/[id]/refund/route.ts:98` — the pre-insert dedup is
  `eq(refunds.txHash, parsed.data.txHash)`. It must also match the chain, e.g.
  `and(eq(refunds.networkKey, payment.chain), eq(refunds.txHash, ...))`.
  Without this the query no longer has a covering index and the check is a
  full scan, and it will reject a valid cross-chain refund that the DB allows.
- `apps/web/app/api/payments/[id]/refund/route.ts:183-192` — the insert does not
  set `networkKey`, so it falls back to the column default `'base'`. On any
  non-Base payment this records the wrong chain. Add
  `networkKey: payment.chain,`.
  (This is why the column has a default at all — so this insert keeps working
  until it is updated. It is not the correct long-term value.)

Note for `audit/_requests-web-lib.md` **API-16**: the hard duplicate guard you
asked to keep does still exist, under the new name and with `network_key` as
the leading column.

---

## B. New columns added on request — they need a writer

These were added because `audit/_requests-*.md` asked for them. They are all
nullable/defaulted, so nothing breaks today, but they are inert until populated.

- `apps/web` checkout-session creation (`app/api/checkout/route.ts`,
  `app/api/checkout-links/route.ts`, `app/pay/[linkId]/page.tsx`) — must write
  `checkoutSessions.customerIdHash = keccak256(stringToBytes(session.id))` at
  creation time, plus a one-off backfill for open sessions. Until then
  `packages/indexer/src/handlers.ts:166` and `:705` must keep the 200-row scan
  as a fallback (IDX-27).
- `apps/web` checkout quote path — must write `checkoutSessions.fiatRateCents`
  and `fiatRateCapturedAt` when the buyer is quoted for a UTXO chain, so
  `packages/utxo-indexer/src/db-callbacks.ts` can compute
  `round(sats * fiatRateCents / 1e8)` instead of assuming one whole coin ==
  $1.00 (IDX-04, Critical). The indexer should copy the snapshot plus
  `amountSats` onto the `payments` row.
- `packages/indexer/src/handlers.ts` — `unmatchedEvents.nextAttemptAt` /
  `status` exist now; the retry sweep should filter
  `status = 'pending' AND next_attempt_at <= now()`, set an exponential
  `next_attempt_at` on each failure, and flip `status = 'abandoned'` at the
  attempt ceiling instead of only logging (IDX-26). Index
  `unmatched_events_retry_idx` supports exactly that predicate.
- `packages/indexer/src/trial-converter.ts` — set
  `subscriptions.trialConversionTxHash` on both the success and failure patches
  (IDX-20).

---

## C. Deferred `DB-` findings that require call-site changes first

### C1. DB-10 — `customers_org_customer_idx` cannot include `livemode` yet

`coupons_org_code_idx` and `invoices_org_number_idx` were widened with
`livemode`. `customers_org_customer_idx` was **not**, because it is an
`ON CONFLICT` target:

- `apps/web/app/api/checkout/[id]/route.ts:239` — `target: [customers.organizationId, customers.customerId]`
- `apps/web/app/api/checkout/[id]/relay/route.ts:467` — same target

Widening the index without updating both targets makes Postgres raise
*"there is no unique or exclusion constraint matching the ON CONFLICT
specification"* on every checkout. To finish DB-10: add `customers.livemode` to
both targets, then ask for the index change. These lookups must also gain a
`livemode` predicate or they will match across modes:

- `packages/indexer/src/handlers.ts:285-286`, `:827-828`
- `packages/solana-indexer/src/db-callbacks.ts:127-128`, `:159-160`
- `apps/web/app/api/checkout/[id]/relay/route.ts:444-445`

### C2. RESOLVED — expression indexes shipped; only the MIXED form is unusable

An earlier revision of this document claimed drizzle-kit could not handle
expression indexes at all. That was over-generalised and is now corrected.

Verified against `drizzle-kit@0.30.6` on Postgres 16.14:

- A **pure** expression index — every column an expression, e.g.
  `index("customers_email_lower_idx").on(sql`lower(email)`)` — generates and
  round-trips `db:push` cleanly.
- A **mixed** index — a plain column plus an expression, e.g.
  `.on(organizationId, sql`lower(email)`)` — crashes introspection with
  `_ZodError … ["indexes","…","columns",1,"expression"] Expected string,
  received null`, which breaks `db:push` and `drizzle-kit studio` permanently
  for that database.

All three hot paths now have pure expression indexes, so **no follow-up is
required**:

| Query | Index shipped |
|---|---|
| `lower(customers.email)` — `relay/dedup.ts:61,70`, every trial checkout | `customers_email_lower_idx` |
| `lower(subscriptions.subscriber_address)` — `relay/dedup.ts:49`, `indexer/src/handlers.ts:559` | `subscriptions_subscriber_lower_idx` |
| `lower(checkout_sessions.merchant_wallet)` — `indexer/src/handlers.ts:233,796`, every `PaymentReceived` | `checkout_sessions_merchant_wallet_lower_idx` |

The only remaining constraint is a **rule for future schema work**: never add a
mixed plain-column + expression index while drizzle-kit is pinned at 0.30.x.
Split it into a pure expression index plus a separate plain index, which is what
`customers` does today (`customers_email_lower_idx` +
`customers_org_created_idx`).

### C3. API-01 (Critical) — drop `.default(false)` on `livemode`

**Owner:** whoever lands the final integration commit for this audit round.
**Gate:** all agents in this round have merged. Nothing else blocks it.
**Not applied here** only because removing the default makes `livemode` a
*required* field in every `$inferInsert`, so a package that gains a new insert
while this round is still in flight would break at compile time.

**Good news — the risk is now near zero.** All 15 production insert sites were
audited and **every one already passes `livemode` explicitly**, and no test file
inserts into these tables directly (they all use mocks). So this should be a
schema-only edit that compiles first try. Verify, do not assume.

**Step 1 — `packages/db/src/schema/`, drop `.default(false)`, keep `.notNull()`:**

- [ ] `checkout-sessions.ts` — `livemode`
- [ ] `customers.ts` — `livemode`
- [ ] `product-prices.ts` — `livemode`
- [ ] `subscriptions.ts` — `livemode`

**Step 2 — confirm each insert site still compiles (all currently comply):**

| # | Site | Table |
|---|---|---|
| 1 | `apps/web/app/api/checkout/route.ts:149` | checkout_sessions |
| 2 | `apps/web/app/api/checkout-links/route.ts:128` | checkout_sessions |
| 3 | `apps/web/app/api/checkout/[id]/relay/route.ts:458` | customers |
| 4 | `apps/web/app/api/checkout/[id]/route.ts:375` | customers |
| 5 | `apps/web/app/api/customers/route.ts:54` | customers |
| 6 | `packages/indexer/src/handlers.ts:273` | customers |
| 7 | `packages/indexer/src/handlers.ts:836` | customers |
| 8 | `packages/solana-indexer/src/db-callbacks.ts:143` | customers |
| 9 | `packages/utxo-indexer/src/settlement.ts:145` | customers |
| 10 | `apps/web/app/api/products/route.ts:174` | product_prices |
| 11 | `apps/web/app/api/products/[id]/route.ts:147` | product_prices |
| 12 | `apps/web/app/api/checkout/[id]/relay/route.ts:521` | subscriptions |
| 13 | `apps/web/app/api/subscriptions/gift/route.ts:98` | subscriptions |
| 14 | `packages/indexer/src/handlers.ts:1000` | subscriptions |
| 15 | `packages/solana-indexer/src/db-callbacks.ts:310` | subscriptions |

Re-derive the list before starting, since line numbers drift:
`grep -rn "insert(checkoutSessions)\|insert(customers)\|insert(productPrices)\|insert(subscriptions)" --include=*.ts apps packages`

**Step 3 — migration.** Append one migration with, for each of the four tables:
`ALTER TABLE "<t>" ALTER COLUMN "livemode" DROP DEFAULT;` Keep `SET NOT NULL`
as-is (it is already NOT NULL). This is metadata-only, no table rewrite.

**Step 4 — verify.** `pnpm --filter @paylix/db db:generate` must report no
changes; `pnpm typecheck` and `pnpm build` must pass across all four packages.

### C3b. SC-03 — `checkout_sessions.max_fee_bps` needs a writer (BLOCKS GASLESS CHECKOUT)

**Column shipped** (`0034_add_max_fee_bps.sql`); **nothing populates it yet**.

**Consequence if it stays unpopulated: gasless checkout does not work at all.**
The client fails closed — it refuses to request a buyer signature when the
session carries no fee ceiling — so every gasless checkout on a session with
`max_fee_bps IS NULL` stops before signing. This is the correct failure mode
(the alternative is a buyer signing a ceiling nobody vouched for), but it means
the writer below is a release blocker, not a nice-to-have.

**Background.** The contracts now bind `maxFeeBps` into the `PaymentIntent`,
`SubscriptionIntent` and `SubscriptionIntentDiscount` typehashes and enforce
`require(platformFee <= maxFeeBps)` at settlement (`PaymentVault.sol:148`,
`SubscriptionManager.sol:267`), closing the retroactive-fee-raise hole. The
ceiling must be **locked at quote time** — reading `platformFee()` live when the
buyer signs re-opens the race the fix exists to close, because the owner can
raise the fee between quote and signature.

**Who must write it — session creation, at quote time:**

- [ ] `apps/web/app/api/checkout/route.ts:160` — `.insert(checkoutSessions)`
- [ ] `apps/web/app/api/checkout-links/route.ts:128` — `.insert(checkoutSessions)`

Both should set `maxFeeBps` from the server-authoritative source that already
exists, `getPlatformFeeBps()` in `apps/web/app/api/_shared/platform-fee.ts`,
resolved against the contract that will settle the session
(`deployment.paymentVault` for one-time, `deployment.subscriptionManager` for
subscriptions). A session whose fee read fails should fail to be created rather
than be stored with a NULL ceiling.

Note `checkout-links` sessions may be quoted before the network/token is chosen
(`network_key` is nullable while `awaiting_currency`); if the settling contract
is not yet known at insert time, the ceiling must instead be written by the
`pick-currency` step — but it must still be written **before** the buyer is
asked to sign, never at signing time.

**Relay side (owner: the API agent).** `apps/web/app/api/checkout/[id]/relay/route.ts:308-330`
currently derives the expected ceiling from a live cached `platformFee()` read
and requires the client's signed value to match **exactly**. Once the session
carries a stored ceiling, that comparison should be made against
`session.maxFeeBps` instead, so a fee raise between quote and relay does not
reject an honestly-signed intent. The live read remains useful as the
`platformFee <= session.maxFeeBps` sanity check.

**Then promote to NOT NULL.** Once both writers land and no
`max_fee_bps IS NULL` rows remain among live sessions, append a migration with
`ALTER TABLE "checkout_sessions" ALTER COLUMN "max_fee_bps" SET NOT NULL;` and
drop the `IS NULL OR` branch from the
`checkout_sessions_max_fee_bps_range` check. Do it in the same commit as the
API-01 `livemode` change (C3) — both make a checkout_sessions column required
and share the same insert sites.

### C4. DB-13 — `customer_id` means two different things

`checkout_sessions.customer_id` and `payment_links.customer_id` are `text`
holding the merchant's *external* identifier, while `payments.customer_id`,
`subscriptions.customer_id`, `invoices.customer_id`, `refund_requests.customer_id`,
`customer_wallets.customer_id` and `customer_notification_preferences.customer_id`
are `uuid` FKs to `customers.id`. Renaming the two text columns to
`external_customer_id` touches every reader; not attempted. Readers to update:
`apps/web/app/api/checkout/[id]/relay/route.ts`, `.../relay/dedup.ts`,
`apps/web/app/api/checkout/route.ts`, `apps/web/app/pay/[linkId]/page.tsx`,
`packages/indexer/src/handlers.ts:285,827`.

### C5. DB-14 — `amount` carries two different scales

`payments.amount`, `refunds.amount`, `refund_requests.amount` are integer cents.
`checkout_sessions.amount`, `product_prices.amount`, `faucet_mints.amount` are
bigint native token units. Renaming to `amount_cents` / `amount_units` is a
pure-rename migration but touches every read/write in `apps/web` and all four
indexers, so it was not attempted.

Also unfinished from DB-14: `payments.subtotal_cents` is nullable while
`payments.tax_cents` is `NOT NULL DEFAULT 0`. Promoting `subtotal_cents` to
`NOT NULL` requires every payment writer to set it
(`packages/indexer/src/handlers.ts`, `packages/solana-indexer/src/db-callbacks.ts`,
`packages/utxo-indexer/src/db-callbacks.ts`) plus a
`subtotal_cents = amount - tax_cents` backfill. Left nullable.

### C6. `timestamp` vs `timestamptz`

Every business table already uses `timestamptz`. The only naive-`timestamp`
columns are the better-auth-managed ones — `user`, `session`, `account`,
`verification`, `organization`, `member`, `invitation`. Converting them means
choosing an interpretation for existing values
(`ALTER COLUMN ... TYPE timestamptz USING col AT TIME ZONE 'UTC'`) and
re-validating better-auth's own reads/writes, so it was left alone
deliberately rather than overlooked.

### C7. DB-16 / DB-18 / DB-17 — outside `packages/db`

- **DB-16** (enum drift) and **DB-18** (network registry drift) both want a
  codegen step in the **SDK** build that emits literal unions from the `pgEnum`
  declarations and from `packages/config/src/network-registry.ts`. The generator
  lives in `packages/sdk`, which this agent does not own. `packages/config` was
  left unchanged on purpose: adding the six non-EVM keys to `NETWORKS` would
  change what `assertValidNetworkKey`
  (`packages/config/src/network-helpers.ts:69-73`) accepts, which is an
  `apps/web` behaviour change.
- **DB-17** — mostly **DONE**, by the repo-hygiene agent rather than this one:
  `packages/db/package.json` and `packages/config/package.json` now both declare
  `lint` (`biome lint .`) and `typecheck` (`tsc --noEmit`), so `pnpm lint` and
  `pnpm typecheck` finally cover the schema. Both pass. (`packages/config`'s new
  `typecheck` initially failed with 5 errors in
  `src/__tests__/networks.test.ts`; fixed here by adding the missing
  `signatureScheme` to a `TokenConfig` fixture and an `optionalToken()` helper
  for token symbols that only exist on some networks — all 81 tests still pass.)
  Only the **schema-lint script** from DB-17 is outstanding: a check asserting
  every FK declares `onDelete`, every `livemode` table includes it in unique
  keys, and every `*.sql` has a journal entry. That last assertion would have
  caught DB-02 and DB-03 automatically.

---

## D. UPGRADE PATH for existing deployments — read before shipping

**Every existing deployment is `db:push`-built.** The migration chain had never
completed on any database (it aborted at 0011 on a missing `organization` table,
in a single transaction, so it always rolled back entirely), which is why no
deployment — including the operator's own `paykit` database — has a
`drizzle.__drizzle_migrations` table at all.

Such a database **cannot simply run `db:migrate`**, even with the chain
repaired. Migration 0000 has no `IF NOT EXISTS` guards, so it fails immediately:

```
PostgresError: type "billing_interval" already exists
```

The whole chain rolls back, so this is *safe but useless* — the database is left
untouched. The guards added in 0007/0031/0032/0033 are never reached.

### The procedure

A script does this: **`packages/db/scripts/baseline-stamp.mjs`**, wired up as
`pnpm --filter @paylix/db db:baseline`.

```bash
# 1. Back up. This writes to drizzle.__drizzle_migrations.
# 2. See what it would do — makes no changes:
pnpm --filter @paylix/db db:baseline -- --dry-run

# 3. Record migrations 0000-0031 as already applied:
pnpm --filter @paylix/db db:baseline

# 4. Apply the only genuinely new work, 0032 and 0033:
pnpm --filter @paylix/db db:migrate
```

It records the sha256 + journal `when` of migrations 0000 through
`0031_rename_owner_to_organization` — whose net effect `db:push` has already
produced — and leaves 0032/0033 to run for real. Those two are fully guarded
(`IF NOT EXISTS`, `pg_constraint` checks), so they are safe against a live
database, and they carry everything push has not already done: the new indexes,
the FK-behaviour changes, and the requested indexer columns.

The cutoff is 0031 and not later **on purpose**: 0031 is guarded against
re-renaming, but its backfill inserts one `organization` row per `user` keyed by
user id. A push-built database already has real organizations with their own
ids, so letting 0031 run would create a spurious duplicate organization for
every user. Stamping skips it.

The script refuses to run unless the database looks like a push-built Paylix
database, aborts if `payments.user_id` still exists (that database genuinely
needs 0031 and must not be stamped past it), and refuses to double-stamp a
database that is already migration-managed.

### Verified

Three lineages were built on Postgres 16.14 and dumped from `information_schema`
+ `pg_catalog`; all three are **identical**:

1. `db:push` from the current schema
2. `db:migrate` from an empty database
3. a database built by `db:push` from the **pre-fix** schema (a faithful stand-in
   for a real deployment), then `db:baseline`, then `db:migrate`

Lineage 3 is what caught a real bug: `btc_session_address_idx` was missing.
That is the DB-04 index which existed only in raw SQL, so `db:push` had already
dropped it from every real deployment — meaning production has been running with
no guard against two checkout sessions sharing a Bitcoin receive address. 0032
now recreates it, and it is declared in the schema so push cannot drop it again.

**For the docs agent:** this section can be lifted into `SELFHOST.md` as an
"Upgrading an existing installation" step. The one caveat worth repeating to
operators is that step 3 must not be skipped or reordered.

---

## E. Operational note on the repaired migration chain

`CREATE INDEX CONCURRENTLY` is **not** used in `0032`. drizzle-orm's migrator
runs the whole chain inside one transaction
(`drizzle-orm/pg-core/dialect.js`: `session.transaction(...)`), and Postgres
forbids `CONCURRENTLY` inside a transaction block. On a large live database,
build the indexes out-of-band with `CREATE INDEX CONCURRENTLY` first — every
`CREATE INDEX` in `0032`/`0033` is `IF NOT EXISTS`, so the migration then
becomes a no-op for them.
