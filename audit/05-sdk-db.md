# SDK, DB Schema & Shared Config Audit

**Scope:** `packages/sdk`, `packages/db`, `packages/config`, `packages/solana-program`
**Date:** 2026-07-31

## Summary

- The Drizzle migration chain is dead. Migrations 0000–0003 create `user_id` / `merchant_id` columns on `products`, `customers`, `payments`, `subscriptions`, `api_keys`, `webhooks`, `checkout_sessions`, `invoices`, `merchant_profiles`, and **no migration ever renames them to `organization_id`**, which is what the current schema declares. `pnpm db:migrate` produces a database the application cannot query. Only `db:push` works, and the two newest migrations (0029, 0030) are not even registered in `_journal.json`.
- Three published SDK methods call HTTP endpoints that do not exist: `listCustomers()`, `getProduct()`, `getSubscription()` all resolve to routes with no matching handler and return 405 unconditionally.
- The SDK's hand-written response types have drifted from the API. `getPayment()` claims to return `PaymentSummary` (token, addresses, `customer.email`, `createdAt`) but the endpoint returns the `verifyPayment` shape — five declared fields are `undefined` at runtime with no type error. `SubscriptionStatus` is missing `"paused"`, which the DB enum has and the API returns verbatim.
- Zero indexes exist on the hottest query paths: the keeper full-scans `subscriptions` every tick on `(status, next_charge_date)`, the webhook retry worker full-scans `webhook_deliveries` on `(status, next_retry_at)`, `checkout_sessions` has no index at all, and every dashboard payment list is an unindexed `organization_id` + `ORDER BY created_at DESC`.
- SDK error handling is five copy-pasted variants of `throw new Error(string)`. No typed error class, no status code, no response body on several paths, no timeout, no retry, no idempotency key. `viem` is declared a runtime dependency and imported nowhere.
- `packages/config` is the healthiest package in scope (typed registry, real test coverage). `packages/db` and `packages/solana-program` have no `lint` or real `test` script, so `pnpm lint` and `pnpm test` never verify the schema at all.

## Finding Counts

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 12 |
| Medium | 18 |
| Low | 5 |

## Findings

### DB-01 — Migration chain never renames `user_id`/`merchant_id` to `organization_id`; `db:migrate` yields an unusable schema

**Severity:** Critical
**File:** `packages/db/migrations/0000_cooing_chronomancer.sql:201`
**Problem:** The initial migration creates `user_id text NOT NULL` on `products`, `customers`, `payments`, `subscriptions`, `api_keys`, `webhooks`, and `checkout_sessions` (lines 12, 32, 59, 76, 91, 108, 127, 139, 161), and `0003_tranquil_millenium_guard.sql:82` creates `invoices` with `merchant_id`. Grepping every `.sql` in `migrations/` shows `organization_id` appears only in migrations 0011, 0014, 0018, 0020, 0021, 0024, 0027 — i.e. only in tables *created* later. No `ALTER TABLE ... RENAME COLUMN` exists anywhere. The current schema (`packages/db/src/schema/payments.ts:13`, `customers.ts:6`, `products.ts:28`, etc.) declares `organization_id` on all of them. The index names confirm the split: migrations produce `customers_user_customer_idx` (`0000:217`), `merchant_profiles_user_idx` (`0003:78`), `invoices_merchant_issued_idx` (`0003:82`); the schema declares `customers_org_customer_idx` (`customers.ts:22`), `invoices_org_issued_idx` (`invoices.ts:89`), `invoices_org_number_idx` (`invoices.ts:85`) — names that appear in no migration. A fresh `pnpm --filter @paylix/db db:migrate` therefore builds a database where every application query fails on a missing column.
**Fix:** Either (a) delete the migration folder and regenerate a single squashed baseline from the current schema with `db:generate`, documenting `db:push` as the only supported path for existing deployments, or (b) author the missing `ALTER TABLE … RENAME COLUMN user_id TO organization_id` / `merchant_id TO organization_id` migrations plus the index renames, and add a CI job that runs `db:migrate` against an empty Postgres and then `db:push --dry-run` to assert zero diff.
**Effort:** L

### DB-02 — Migrations 0029 and 0030 are absent from `_journal.json` and will never be applied

**Severity:** High
**File:** `packages/db/migrations/meta/_journal.json:191`
**Problem:** The journal's last entry is `0028_add_customer_wallets`. `0029_add_tax_breakdown.sql` and `0030_add_utxo_support.sql` exist on disk but have no journal entry, and `drizzle-kit migrate` drives strictly off the journal. The tax-breakdown columns (`payments.tax_cents`, `tax_rate_bps`, `tax_label`, `subtotal_cents` — declared at `packages/db/src/schema/payments.ts:28-31`) and all UTXO columns (`checkout_sessions.btc_receive_address`, `btc_session_index` — `checkout-sessions.ts:55-56`) are silently skipped.
**Fix:** Add the two missing journal entries with correct `idx`/`when` values, or regenerate the journal as part of the DB-01 squash.
**Effort:** S

### DB-03 — Journal entries are out of order and snapshot metadata stops at 0011

**Severity:** High
**File:** `packages/db/migrations/meta/_journal.json:55`
**Problem:** Entry `"idx": 11` is listed in the 8th array position, before `"idx": 8` and `"idx": 9`. The `when` timestamps also run backwards: `1776355200000` (0012) is followed by `1744416000000` (0013, `_journal.json:85`) — a jump ~1 year into the past. Separately, `migrations/meta/` contains snapshots only for 0000–0006, 0009, and 0011; there is no snapshot for 0010 or for anything from 0012 through 0030. `drizzle-kit generate` diffs the newest snapshot against the schema, so the next generated migration will attempt to recreate roughly 18 migrations' worth of objects.
**Fix:** Regenerate `meta/` from the current schema as a single baseline snapshot alongside the DB-01 squash. Add a CI check that asserts every `*.sql` in `migrations/` has a matching journal entry and that `idx` is strictly increasing.
**Effort:** M

### DB-04 — `checkout_sessions` has zero indexes, and its only unique index exists solely in raw SQL

**Severity:** High
**File:** `packages/db/src/schema/checkout-sessions.ts:14`
**Problem:** `pgTable("checkout_sessions", {...})` is declared with no third argument, so the table has no index other than the PK. Sessions are looked up and swept by `organization_id`, `status`, `expires_at`, and `payment_id` (e.g. `apps/web/app/api/checkout-links/route.ts:34-42`, `packages/indexer/src/abandonment.ts:61`, and the `leftJoin(checkoutSessions, eq(checkoutSessions.paymentId, payments.id))` at `apps/web/app/api/payments/[id]/route.ts:69`) — all full scans. Worse, `packages/db/migrations/0030_add_utxo_support.sql:13` creates `CREATE UNIQUE INDEX btc_session_address_idx ON checkout_sessions (btc_receive_address) WHERE btc_receive_address IS NOT NULL`, but that index is not declared in the schema file. Since `db:push` diffs against the schema, running it drops the index and removes the only guard against two sessions sharing a Bitcoin receive address.
**Fix:** Add the index array to `checkoutSessions`: `index("checkout_sessions_org_created_idx").on(organizationId, createdAt)`, `index("checkout_sessions_status_expires_idx").on(status, expiresAt)`, `index("checkout_sessions_payment_idx").on(paymentId)`, and re-declare `btc_session_address_idx` as a partial `uniqueIndex(...).where(sql\`btc_receive_address is not null\`)`.
**Effort:** S

### DB-05 — `subscriptions` has no index on `(status, next_charge_date)`; the keeper full-scans every tick

**Severity:** High
**File:** `packages/db/src/schema/subscriptions.ts:87`
**Problem:** The only index is `uniqueIndex("subscriptions_contract_on_chain_id_idx")`. The keeper's core loop at `packages/indexer/src/keeper.ts:64-72` runs `select * from subscriptions where status = 'active' and next_charge_date <= now()` on every interval, with no supporting index — a sequential scan of the entire subscription table on every keeper tick, forever. `organization_id`, `customer_id`, and `subscriber_address` are also unindexed despite driving the dashboard list and the trial-dedup lookups.
**Fix:** Add `index("subscriptions_due_idx").on(status, nextChargeDate)` (or a partial index `WHERE status = 'active'`), plus `index("subscriptions_org_created_idx").on(organizationId, createdAt)` and `index("subscriptions_customer_idx").on(customerId)`.
**Effort:** S

### DB-06 — `payments` and `customers` have no indexes on their hot lookup columns

**Severity:** High
**File:** `packages/db/src/schema/payments.ts:35`
**Problem:** `payments` declares only `uniqueIndex("payments_chain_tx_idx")`. Every dashboard and API listing does `where organization_id = ? order by created_at desc` (`apps/web/app/api/payments/route.ts:72`, `apps/web/app/(dashboard)/payments/page.tsx:34`, `apps/web/app/api/payments/export/route.ts:46`, `apps/web/app/api/portal/[customerId]/route.ts:74`) against no index. `customer_id`, `product_id`, and `status` are also unindexed despite being the SDK's documented `listPayments` filters. Likewise `customers` (`packages/db/src/schema/customers.ts:21-23`) indexes only `(organization_id, customer_id)`, while the trial anti-abuse dedup queries by lowered email and wallet address (`apps/web/app/api/checkout/[id]/relay/dedup.ts:52,60`) — a full scan on a path that runs on every trial checkout.
**Fix:** Add `index("payments_org_created_idx").on(organizationId, createdAt)`, `index("payments_customer_idx").on(customerId)`, `index("payments_status_idx").on(status)`; and on `customers`, `index("customers_email_idx").on(sql\`lower(email)\`)` and `index("customers_wallet_idx").on(walletAddress)`.
**Effort:** S

### DB-07 — `webhook_deliveries` has no index; the retry worker scans the full delivery log

**Severity:** High
**File:** `packages/db/src/schema/webhook-deliveries.ts:6`
**Problem:** The table is declared with no index array. `packages/indexer/src/webhook-dispatch.ts:199-201` selects `where status = 'failed' and next_retry_at <= now()` on a loop, and `packages/indexer/src/alerts.ts:198-202` aggregates by `created_at`. This table grows monotonically with every webhook ever sent, so the scan cost grows without bound. There is also no index on `webhook_id`, which the delivery-history UI and `replayWebhookDelivery` need.
**Fix:** Add `index("webhook_deliveries_retry_idx").on(status, nextRetryAt)`, `index("webhook_deliveries_webhook_created_idx").on(webhookId, createdAt)`, and a retention/prune job for delivered rows.
**Effort:** S

### DB-08 — `unmatched_events` has no unique constraint, so the retry queue can double-process an event

**Severity:** High
**File:** `packages/db/src/schema/unmatched-events.ts:3`
**Problem:** The table records `eventType`, `txHash`, `blockNumber`, `logIndex` but declares no index or unique constraint. `packages/indexer/src/handlers.ts:94` inserts unconditionally. On an indexer restart, a reorg, or an overlapping block range, the same `(tx_hash, log_index)` is inserted twice; the retry loop (`handlers.ts:1426-1502`) then processes it twice, and since the retry path creates payment rows, this can produce duplicate payments. This directly undermines the documented "unmatched events are retained, not dropped" invariant — retention without dedup is worse than dropping.
**Fix:** Add `uniqueIndex("unmatched_events_dedup_idx").on(txHash, logIndex, eventType)` and switch the insert to `.onConflictDoNothing()`. Add `index("unmatched_events_created_idx").on(createdAt)` for the ordered retry scan at `handlers.ts:1431`.
**Effort:** S

### SDK-01 — Three public SDK methods call endpoints that do not exist

**Severity:** High
**File:** `packages/sdk/src/customers.ts:64`
**Problem:** `listCustomers()` issues `GET {backendUrl}/api/customers`, but `apps/web/app/api/customers/route.ts` exports only `POST` (line 19) — Next.js returns 405. `getProduct()` (`packages/sdk/src/products.ts:27`) issues `GET /api/products/{id}`, but `apps/web/app/api/products/[id]/route.ts` exports only `PATCH` (line 49) and `DELETE` (line 175). `getSubscription()` (`packages/sdk/src/subscriptions.ts:32`) issues `GET /api/subscriptions/{id}`, but `apps/web/app/api/subscriptions/[id]/route.ts` exports only `PATCH` (line 13). All three are exposed on the `Paylix` class (`client.ts:183`, `:195`, `:219`) and shipped to npm; all three throw `"Failed to list customers (405)"` / `"Product not found (405)"` / `"Subscription not found (405)"` for every caller. None of the three has a test.
**Fix:** Either implement the missing `GET` handlers or remove the three methods from the public class and `index.ts` before the next publish. Add a contract test that asserts every SDK method's `(method, path)` pair resolves to an exported route handler.
**Effort:** M

### SDK-02 — `getPayment()` declares a return type the endpoint does not produce

**Severity:** High
**File:** `packages/sdk/src/payments.ts:32`
**Problem:** `getPayment()` casts the response of `GET /api/payments/{id}` to `PaymentSummary` (`packages/sdk/src/types.ts:224`), which declares `token`, `fromAddress`, `toAddress`, `createdAt`, and `customer: CustomerInfo`. The route (`apps/web/app/api/payments/[id]/route.ts:73-85`) returns `{ verified, amount, fee, txHash, chain, customerId, productId, status, metadata, livemode }` — none of those five fields exist in the payload. `verifyPayment()` (`packages/sdk/src/verify.ts:3`) hits the *same* endpoint and casts it to a *different* type, `VerifyPaymentResult`. A consumer writing `(await paylix.getPayment(id)).customer.email` type-checks cleanly and throws `Cannot read properties of undefined` at runtime.
**Fix:** Make `getPayment` return `VerifyPaymentResult` (and add the missing `livemode` field to that interface), or extend the route to return the full summary shape. Replace the blanket `as T` casts with a runtime-validated parse so drift fails loudly.
**Effort:** M

### SDK-03 — `SubscriptionStatus` is missing `"paused"`, which the database emits

**Severity:** High
**File:** `packages/sdk/src/types.ts:1`
**Problem:** The SDK union is `active | past_due | cancelled | expired | trialing | trial_conversion_failed`. The database enum (`packages/db/src/schema/subscriptions.ts:7-15`) includes `"paused"`, and the API returns the column verbatim. The SDK even exposes `SubscriptionSummary.pausedAt` (`types.ts:261`) and the DB has a `paused_by` column, so paused subscriptions demonstrably exist. Any consumer writing an exhaustive `switch` on `sub.status` silently falls through for paused subs, and `ListSubscriptionsParams.status` (`types.ts:245`) rejects `"paused"` as a filter value even though the server accepts it.
**Fix:** Add `"paused"` to the union. Longer term, generate the union from the DB enum during the SDK build (a codegen step is compatible with the no-workspace-deps invariant since the output is a plain literal type) and add a test asserting parity.
**Effort:** S

### SDK-04 — No typed error class; every failure is a bare `Error` with a formatted string

**Severity:** High
**File:** `packages/sdk/src/checkout.ts:29`
**Problem:** Every one of the ~40 request functions ends in `throw new Error(\`Paylix ... failed: ${msg}\`)` (e.g. `checkout.ts:29`, `customers.ts:23`, `admin.ts:24`, `payment-links.ts:49`, `coupons.ts:55`). The HTTP status, the machine-readable error code the API returns (`{ error: { code: "unauthorized", ... } }`, see `apps/web/app/api/payments/[id]/route.ts:48`), the request path, and any retry hint are all discarded into a string. Consumers cannot distinguish 401 (bad key) from 404 (missing resource) from 429 (rate-limited) from 500 without regex-matching an error message that is not part of any stability contract. Network-level `fetch` rejections (DNS failure, connection reset) propagate as raw `TypeError` with no Paylix branding at all.
**Fix:** Export a `PaylixError extends Error` with `status: number`, `code: string`, `body: unknown`, and `requestId?: string`, plus subclasses or a discriminant for `authentication | invalid_request | not_found | rate_limit | api | connection`. Throw it from a single shared request helper (see SDK-06) and export the class from `index.ts` so `instanceof` works.
**Effort:** M

### SDK-05 — `viem` is a declared runtime dependency but is imported nowhere in the SDK

**Severity:** High
**File:** `packages/sdk/package.json:45`
**Problem:** `"dependencies": { "viem": "^2" }`, and `tsup.config.ts:10` marks it external. A recursive grep for `viem` across `packages/sdk/src/` returns zero matches. Every consumer of `@paylix/sdk` therefore installs viem (a multi-megabyte package with its own transitive tree) for nothing. This also makes the SDK look like it needs a wallet/RPC layer when it is purely an HTTP client.
**Fix:** Delete the dependency and drop `external: ["viem"]` from `tsup.config.ts`. If viem types are wanted later for address branding, add it as an optional `peerDependency` with `peerDependenciesMeta.optional`.
**Effort:** S

### SDK-06 — Five different error-parsing shapes, several of which discard the response body

**Severity:** Medium
**File:** `packages/sdk/src/payment-links.ts:63`
**Problem:** There is no shared request helper, so each module reinvents error handling. Four incompatible parse shapes exist: `{ error?: string }` (`checkout.ts:28`), `{ error?: { message?: string } }` (`customers.ts:22`), the union of both (`admin.ts:17-19`, `coupons.ts:50`), and `Record<string, unknown>` (`webhook-management.ts:107`). A fifth group does not read the body at all and reports only `res.statusText` — `payment-links.ts:63,77,89`, `coupons.ts:65,79,138`, `blocklist.ts:27,66`, `subscription-schedule.ts:93` — so a 400 with a precise validation message surfaces to the developer as `"Paylix coupon list failed: Bad Request"`. The same request boilerplate (headers, `Authorization`, `JSON.stringify`) is duplicated ~40 times.
**Fix:** Extract one `request<T>(config, method, path, { body, query })` helper that builds headers once, parses the error body through a single normalizer handling all observed server shapes, and throws `PaylixError` (SDK-04). Rewrite all modules to call it.
**Effort:** M

### SDK-07 — No timeout, no retry/backoff, and no idempotency-key support

**Severity:** Medium
**File:** `packages/sdk/src/client.ts:116`
**Problem:** Every call is a bare `await fetch(...)` with no `signal`, so a hung backend hangs the caller indefinitely (Node's default is no timeout). There is no retry on 5xx or 429, and the `Retry-After` header returned by the rate limiter is ignored. `PaylixConfig` (`packages/sdk/src/types.ts:37-41`) exposes no `timeout`, `maxRetries`, or `fetch` override hook. Separately, the backend has a full idempotency implementation (`packages/db/src/schema/idempotency-keys.ts`), but no SDK method accepts or auto-generates an `Idempotency-Key` header — so a retried `createCheckout` or `refundPayment` double-charges.
**Fix:** Add `timeoutMs` (default 30s, via `AbortSignal.timeout`), `maxRetries` (default 2, exponential backoff with jitter, only on 429/5xx/network errors and only for idempotent or idempotency-keyed requests), and a `fetch?: typeof fetch` injection point to `PaylixConfig`. Auto-generate an `Idempotency-Key` for every POST and let callers override it.
**Effort:** M

### SDK-08 — `PaylixNetwork` and `SubscriptionStatus` are not exported to consumers

**Severity:** Medium
**File:** `packages/sdk/src/index.ts:32`
**Problem:** The `export type { ... } from "./types"` block lists 30 types but omits `PaylixNetwork` and `SubscriptionStatus`. `PaylixNetwork` is the type of the required `PaylixConfig.network` field (`types.ts:39`), so a consumer cannot write `const network: PaylixNetwork = ...` or type a config factory without copying the union by hand. `SubscriptionStatus` is the type of `SubscriptionSummary.status` (`types.ts:254`) and of `ListSubscriptionsParams.status` (`types.ts:245`), so consumers cannot annotate a status-handling function either.
**Fix:** Add both names to the `index.ts` export block. Audit the rest of `types.ts` for other publicly-referenced-but-unexported names at the same time.
**Effort:** S

### SDK-09 — Bare `"crypto"` specifier, `Buffer` in the public `.d.ts`, and no `engines` field

**Severity:** Medium
**File:** `packages/sdk/src/webhooks.ts:1`
**Problem:** `import { createHmac, timingSafeEqual } from "crypto"` uses the bare specifier rather than `node:crypto`. Bundlers and edge runtimes resolve `crypto` differently (some to the browser Web Crypto shim, some to nothing), so this breaks in Next.js edge routes, Cloudflare Workers, and Vite browser builds — and because `index.ts:2` re-exports `webhooks` from the single entry point, *any* browser import of the SDK pulls the module in. Separately, `WebhookVerifyParams.payload` is typed `string | Buffer` (`packages/sdk/src/types.ts:294`), which puts the `Buffer` global into the emitted `.d.ts` while `@types/node` is only a `devDependency` (`package.json:49`) — consumers without `@types/node` get `Cannot find name 'Buffer'`. There is no `engines` field declaring the minimum Node version, despite the SDK depending on global `fetch` (Node 18+).
**Fix:** Change the import to `node:crypto`. Add a separate `./webhooks` export path so browser bundles never pull node builtins. Type `payload` as `string | Uint8Array` to drop the `@types/node` requirement from the public surface. Add `"engines": { "node": ">=18" }`.
**Effort:** M

### SDK-10 — Published-artifact metadata is incomplete

**Severity:** Medium
**File:** `packages/sdk/package.json:36`
**Problem:** `"files": ["dist"]` excludes `README.md` and the AGPL license text, so the npm page renders empty and the package ships without its license file despite an AGPL-3.0 declaration. There is no `"sideEffects": false`, so bundlers cannot tree-shake the unused half of the SDK out of consumer bundles — every app importing only `createCheckout` still ships the coupon, blocklist, refund, and webhook-management modules. There is no `publishConfig.access`, no `engines` (see SDK-09), and the version is `0.0.1` for a surface of 40+ methods with no CHANGELOG.
**Fix:** Add `"README.md"` and `"LICENSE"` to `files`, add `"sideEffects": false`, add `engines`, add a CHANGELOG, and adopt a real semver line before the first external consumer.
**Effort:** S

### SDK-11 — `NETWORKS` publicly exports the zero address as every contract address

**Severity:** Medium
**File:** `packages/sdk/src/networks.ts:19`
**Problem:** `NETWORKS` is exported from `index.ts:3`, and every one of its 20 entries sets `paymentVaultAddress` and `subscriptionManagerAddress` to `0x0000000000000000000000000000000000000000` (lines 19-20, 26-27, 34-35, … 179-180). All eight testnet entries additionally set `usdcAddress` to the zero address, and the six non-EVM entries (`solana`, `bitcoin`, `litecoin`, …) fill EVM-shaped fields with zero addresses that are structurally meaningless for those chains. A consumer who reads `NETWORKS.base.paymentVaultAddress` — a plausible thing to do given the field name — gets a valid-looking address that burns funds. The header comment acknowledges these are placeholders, but the type gives no hint.
**Fix:** Remove `paymentVaultAddress` / `subscriptionManagerAddress` from the exported `NetworkConfig` (`types.ts:309-316`) entirely — the comment already states the backend is authoritative. If they must stay, type them `` `0x${string}` | null `` and set them to `null`. Split the non-EVM rows into their own type rather than filling EVM fields with zeros.
**Effort:** S

### SDK-12 — `PaylixConfig.network` is required and validated but never affects any request

**Severity:** Medium
**File:** `packages/sdk/src/client.ts:119`
**Problem:** The constructor throws if `NETWORKS[config.network]` is missing, making `network` a mandatory field. It is then used only by the `get network()` accessor (`client.ts:125-127`). No request function reads it — every checkout/subscription call passes `networkKey` per-call instead (`checkout.ts:14`, `subscription.ts:21`), and the rest of the SDK never touches it. So a merchant configured with `network: "base"` who passes `networkKey: "arbitrum"` gets an Arbitrum checkout with no warning, and a merchant on a chain the SDK's hardcoded union does not list (see DB-18) cannot construct a client at all even though the backend supports it.
**Fix:** Make `network` optional and use it as the default for `networkKey` when a call omits it, or remove it from `PaylixConfig` and let `networkKey` be the sole selector. Either way, stop throwing on values the backend may legitimately accept.
**Effort:** S

### SDK-13 — Call and return conventions are inconsistent across the public class

**Severity:** Medium
**File:** `packages/sdk/src/client.ts:279`
**Problem:** Three argument styles coexist with no rule. Options object: `cancelSubscription({ subscriptionId })` (`client.ts:137`), `verifyPayment({ paymentId })` (`:145`). Positional: `applyCouponToCheckout(sessionId, code)` (`:279`), `extendTrial(subscriptionId, days)` (`:315`), `sendTestWebhook(webhookId, event)` (`:331`), `rescheduleSubscription(subscriptionId, nextChargeDate)` (`:323`). Hybrid: `updateCustomer(id, params)` (`:179`), `updatePaymentLink(id, params)` (`:259`). Deletion return shapes are equally arbitrary: `deleteCustomer` → `{ ok: true }` (`:187`), `deleteWebhook` → `{ success: true }` (`:239`), `archivePaymentLink` → `void` (`:263`), `archiveCoupon` → `void` (`:275`), `removeBlocklistEntry` → `void` (`:295`). Naming mixes `delete` / `archive` / `remove` for the same operation, and `cancelSubscription` (immediate, gasless route) sits next to `scheduleSubscriptionCancellation` (period-end) with no naming relationship.
**Fix:** Standardize on `method(id, options?)` for single-resource operations and `method(options)` otherwise; make every destructive method return `void` or a uniform `{ id, deleted: true }`. Pick one verb per semantic (`delete` for hard, `archive` for soft) and alias the old names as deprecated for one major version.
**Effort:** M

### SDK-14 — No pagination on any list method

**Severity:** Medium
**File:** `packages/sdk/src/customers.ts:64`
**Problem:** `listCustomers` (`customers.ts:64`), `listProducts` (`products.ts:61`), `listWebhooks` (`webhook-management.ts:8`), `listCoupons` (`coupons.ts:60`), `listPaymentLinks` (`payment-links.ts:56`), and `listBlocklist` (`blocklist.ts:20`) take no parameters at all and return a bare array. `listPayments` and `listSubscriptions` accept a `limit` capped at 100 (`types.ts:221`, `:249`) but no cursor or offset, so there is no way to reach record 101. A merchant with 10k customers has no supported way to enumerate them through the SDK, and every list response is an unbounded array with no `has_more` signal.
**Fix:** Introduce a `Page<T>` return type (`{ data: T[]; hasMore: boolean; nextCursor: string | null }`) and a `{ limit?, cursor? }` params object on every list method, plus an async-iterator helper (`for await (const c of paylix.customers.list())`). Coordinate with the API routes so cursors are server-issued.
**Effort:** L

### SDK-15 — Six modules covering a third of the public surface have zero tests

**Severity:** Medium
**File:** `packages/sdk/src/admin.ts:29`
**Problem:** `packages/sdk/src/__tests__/` contains 13 files covering checkout, client, customers, invoices, payments, portal, products, subscription, subscriptions, test, verify, webhook-management, and webhooks. There is no test file for `admin.ts` (`extendTrial`, `compCharge`, `rescheduleSubscription` — all money-affecting), `refunds.ts` (`refundPayment`), `coupons.ts` (5 methods), `blocklist.ts` (3 methods), `payment-links.ts` (5 methods), `subscription-schedule.ts` (`giftSubscription`, `scheduleSubscriptionCancellation`, `resumeSubscriptionSchedule`), or `networks.ts`. That is 18 untested public methods, including every one that moves or forgives money. This is also why SDK-01's three dead methods were never caught.
**Fix:** Add fetch-mocked tests for each untested module following the existing `__tests__/payments.test.ts` pattern, asserting URL, method, headers, request body, success parse, and error parse. Add a coverage gate that fails when a public `Paylix` method has no test.
**Effort:** M

### SDK-16 — `createPaymentLink` fabricates the public URL client-side

**Severity:** Low
**File:** `packages/sdk/src/payment-links.ts:53`
**Problem:** `return { link, url: \`${config.backendUrl}/pay/${link.id}\` }` builds the shareable URL by string-concatenating the API base URL with a hardcoded `/pay/` path. Any deployment where the public checkout host differs from the API host (a separate checkout domain, a CDN, a reverse proxy prefix) or where the route path ever changes produces a broken link that the SDK reports as valid. `createPortalSession` (`invoices.ts:9`) correctly takes the server's URL instead.
**Fix:** Have `POST /api/payment-links` return the canonical `url` and pass it through unchanged, matching the portal-session pattern.
**Effort:** S

### SDK-17 — README documents 6 of 40+ methods and shows an `sk_` key with no server-only warning

**Severity:** Low
**File:** `packages/sdk/README.md:18`
**Problem:** The quick start instantiates `new Paylix({ apiKey: 'sk_test_...' })` with no note that secret keys must never reach client code — the single most consequential thing a payments SDK README can say, given the documented `pk_`/`sk_` split. The README then documents only `createCheckout`, `createSubscription`, `verifyPayment`, `listPayments`, `listSubscriptions`, `createWebhook`, and `webhooks.verify`; the other ~35 public methods (coupons, blocklist, refunds, payment links, gifting, admin trial operations, portal sessions) are undocumented. It also claims "USDC payments on Base" (line 3) while the SDK ships 20 network keys across 7 EVM chains plus Solana and UTXO chains. JSDoc exists on only 4 methods in `client.ts` (lines 153, 162) and none in `admin.ts`, `coupons.ts`, `blocklist.ts`, or `refunds.ts`.
**Fix:** Add a prominent "`sk_` is server-only, `pk_` is client-safe" section at the top, correct the network claim, generate an API reference from JSDoc, and require JSDoc on every method exposed by the `Paylix` class via a lint rule.
**Effort:** M

### SDK-18 — Duplicate param types and duplicated request bodies between checkout and subscription

**Severity:** Low
**File:** `packages/sdk/src/types.ts:73`
**Problem:** `CreateSubscriptionParams` (`types.ts:73-96`) is field-for-field identical to `CreateCheckoutParams` (`types.ts:43-66`), including the copied doc comments. The corresponding functions `createCheckout` (`checkout.ts:7-32`) and `createSubscription` (`subscription.ts:13-45`) build byte-identical bodies and hit the identical endpoint, differing only by `type: "subscription"` (`subscription.ts:15`) and by which fields the result destructures. Any new checkout field must be added in four places, and the two `buildQuery` helpers in `payments.ts:3-16` and `subscriptions.ts:3-16` are likewise identical.
**Fix:** Define `CreateCheckoutParams` once and `export type CreateSubscriptionParams = CreateCheckoutParams`. Collapse the two functions into one private `createSession(config, params, type)`. Hoist the shared `buildQuery` into a single internal module.
**Effort:** S

### DB-09 — `idempotency_keys` has no primary key and no index on `expires_at`

**Severity:** Medium
**File:** `packages/db/src/schema/idempotency-keys.ts:4`
**Problem:** The table declares five columns and one `uniqueIndex("idempotency_keys_org_key_idx")` but no `.primaryKey()` and no composite PK. Postgres allows this, but the table has no logical row identity for replication, no `ctid`-stable ordering, and Drizzle cannot generate a typed `where` on a PK. `expiresAt` is `notNull` (line 17), implying a sweeper, but has no index — so expiry cleanup is a full scan of a table that receives a row per idempotent API request.
**Fix:** Promote the unique index to `primaryKey({ columns: [organizationId, key] })` and add `index("idempotency_keys_expires_idx").on(expiresAt)`.
**Effort:** S

### DB-10 — `livemode` is inconsistently included in unique constraints

**Severity:** Medium
**File:** `packages/db/src/schema/customers.ts:22`
**Problem:** `blocklist_entries` correctly scopes its unique key by mode: `uniqueIndex("blocklist_entries_unique").on(organizationId, type, value, livemode)` (`blocklist-entries.ts:36-41`). But `customers_org_customer_idx` (`customers.ts:22`), `coupons_org_code_idx` (`coupons.ts:54`), and `invoices_org_number_idx` (`invoices.ts:85`) omit `livemode` even though all three tables carry the column. Consequence: a merchant cannot create a test-mode customer with the same external `customerId` as their live customer, cannot create a `WELCOME10` coupon in both modes, and the invoice number sequence collides across modes. This is a footgun for anyone testing against production data shapes.
**Fix:** Add `livemode` to those three unique indexes (a migration must first resolve any existing collisions), and add a schema-level convention: every unique constraint on a table with a `livemode` column must include it.
**Effort:** M

### DB-11 — Four uuid columns reference other tables with no foreign key

**Severity:** Medium
**File:** `packages/db/src/schema/checkout-sessions.ts:41`
**Problem:** `checkoutSessions.appliedCouponId` (line 41), `checkoutSessions.paymentId` (line 43), `checkoutSessions.subscriptionId` (line 44), and `subscriptions.appliedCouponId` (`subscriptions.ts:74`) are plain `uuid(...)` with no `.references()`. All four are dereferenced as if they were FKs — e.g. `apps/web/app/api/payments/[id]/route.ts:69` joins `checkoutSessions.paymentId` to `payments.id`. Nothing prevents a dangling reference, and deleting a coupon or payment leaves orphaned pointers that the join silently drops. Note the same file's sibling table `coupon_redemptions` (`coupons.ts:68-77`) *does* declare all three of the analogous FKs with `onDelete: "set null"`, showing the omission is accidental.
**Fix:** Add `.references(() => coupons.id, { onDelete: "set null" })`, `.references(() => payments.id, { onDelete: "set null" })`, and `.references(() => subscriptions.id, { onDelete: "set null" })` to the four columns, after a data-cleanup migration removes existing orphans.
**Effort:** M

### DB-12 — Core foreign keys declare no `ON DELETE` behavior

**Severity:** Medium
**File:** `packages/db/src/schema/payments.ts:12`
**Problem:** `payments.productId` (line 12) and `payments.customerId` (line 14) use `.references(() => products.id)` / `.references(() => customers.id)` with no options, as do `subscriptions.productId` (`subscriptions.ts:46`), `subscriptions.customerId` (`:48`), and `subscriptions.lastPaymentId` (`:58`). Postgres defaults to `NO ACTION`, so deleting a product or customer that has ever been paid for errors out at the DB layer with a raw constraint-violation message. Meanwhile the org-level FKs on the same tables *do* declare `onDelete: "cascade"` (`payments.ts:13`), so deleting an organization cascades to payments but deleting a customer within it hard-errors — an inconsistent and surprising split. The `customers` table has a `deletedAt` column (`customers.ts:20`) indicating soft-delete is the intended path, but nothing enforces it.
**Fix:** Declare the intent explicitly on each FK: `onDelete: "restrict"` where a hard error is correct (make it deliberate, not a default), `"set null"` for `lastPaymentId`. Document soft-delete as the required path for customers and products, and add the matching partial indexes on `deleted_at IS NULL`.
**Effort:** M

### DB-13 — `customer_id` is a uuid FK in some tables and free text in others

**Severity:** Medium
**File:** `packages/db/src/schema/checkout-sessions.ts:18`
**Problem:** `payments.customerId` (`payments.ts:14`), `subscriptions.customerId` (`subscriptions.ts:48`), `invoices.customerId` (`invoices.ts:33`), `refundRequests.customerId`, `customerWallets.customerId`, and `customerNotificationPreferences.customerId` are all `uuid` referencing `customers.id`. But `checkoutSessions.customerId` (`checkout-sessions.ts:18`) and `paymentLinks.customerId` (`payment-links.ts:25`) are `text("customer_id")` holding the merchant's *external* customer identifier (`customers.customerId`, itself `text` at `customers.ts:7`). Two different values share one column name across the schema, with no naming distinction and no FK on the text variants. Reading a join condition requires knowing which flavor a given table uses.
**Fix:** Rename the text-typed columns to `external_customer_id` (matching what they hold), or convert them to `uuid` FKs and resolve the external ID at write time. Either way, one name must mean one thing schema-wide.
**Effort:** M

### DB-14 — `amount` means integer cents in some tables and native token bigint in others

**Severity:** Medium
**File:** `packages/db/src/schema/payments.ts:15`
**Problem:** `payments.amount` is `integer` cents (line 15), as are `refunds.amount` (`refunds.ts:40`) and `refundRequests.amount` (`refund-requests.ts:43`). But `checkoutSessions.amount` is `bigint` in native token units (`checkout-sessions.ts:20`), as are `productPrices.amount` (`product-prices.ts:33`) and `faucetMints.amount` (`faucet-mints.ts:10`). The same column name carries two different scales and two different types across tables that are joined to each other. The codebase clearly knows the suffix convention — `refundedCents`, `taxCents`, `subtotalCents`, `discountCents`, `amountOffCents`, `unitAmountCents` all carry it — the unsuffixed `amount` columns are the exceptions. Within `payments` itself the nullability is also inconsistent: `taxCents` is `notNull().default(0)` (line 28) while `subtotalCents` is nullable (line 31) despite both arriving from the same migration (`0029_add_tax_breakdown.sql`), so consumers must null-check one and not the other.
**Fix:** Rename to `amount_cents` (integer-cents tables) and `amount_units` or `amount_wei` (native-unit tables) so the unit is never ambiguous at a call site. Backfill `subtotal_cents` from `total - tax` and make it `NOT NULL`.
**Effort:** M

### DB-15 — `refunds.tx_hash` is globally unique with no chain column

**Severity:** Medium
**File:** `packages/db/src/schema/refunds.ts:54`
**Problem:** `uniqueIndex("refunds_tx_hash_idx").on(table.txHash)` is unique across the whole table, and the adjacent comment (lines 51-53) explicitly justifies it with "for our single-chain setup it's globally unique." That assumption is already false: `payments` carries a `chain` column (`payments.ts:19`) and dedups on `(chain, tx_hash)` (`payments.ts:35`), `product_prices` and `subscriptions` carry `network_key`, and the config registry ships 14 EVM chains. The `refunds` table has neither `chain` nor `network_key`, so a legitimate refund on chain B whose tx hash collides with one on chain A is rejected, and the dashboard cannot tell which chain a refund settled on.
**Fix:** Add `networkKey: text("network_key").notNull()` (backfilled from the parent payment's `chain`) and change the unique index to `(networkKey, txHash)`, mirroring `payments_chain_tx_idx`.
**Effort:** M

### DB-16 — Status enums are re-declared as string literals in three packages instead of shared

**Severity:** Medium
**File:** `packages/db/src/schema/subscriptions.ts:7`
**Problem:** `subscriptionStatusEnum` (7 values, `subscriptions.ts:7-15`) is duplicated by hand as `SubscriptionStatus` in `packages/sdk/src/types.ts:1-7` (6 values — see SDK-03 for the resulting bug). The same pattern repeats for `couponTypeEnum` / `couponDurationEnum` (`coupons.ts:17-22`) vs `CouponType` / `CouponDuration` (`packages/sdk/src/coupons.ts:3-4`), `blocklistTypeEnum` (`blocklist-entries.ts:13-17`) vs `BlocklistType` (`packages/sdk/src/blocklist.ts:3`), `refundStatusEnum` (`refunds.ts:15-19`) vs `Refund["status"]` (`packages/sdk/src/refunds.ts:16`), `paymentStatusEnum` (`payments.ts:6`) vs the inline union at `packages/sdk/src/types.ts:134`, and `billingIntervalEnum` (`products.ts:17-24`) vs the inline unions at `types.ts:393` and `:417`. Twelve independent copies of six enums, with a proven drift already shipped. The SDK's no-workspace-deps invariant is the reason, but nothing currently detects divergence.
**Fix:** Add a codegen step to the SDK build that reads the `pgEnum` declarations from `packages/db/src/schema/` and emits `packages/sdk/src/generated/enums.ts` as plain literal unions — this keeps the SDK's published `package.json` dependency-free while making drift impossible. Fail the build if the generated file differs from the committed one.
**Effort:** M

### DB-17 — `packages/db` and `packages/solana-program` are excluded from lint and test verification

**Severity:** Low
**File:** `packages/db/package.json:11`
**Problem:** `packages/db/package.json` declares only `db:generate`, `db:migrate`, `db:push`, and `db:studio` — no `build`, `lint`, `test`, or `typecheck`. Since `turbo.json` drives `lint` and `test` off package scripts, `pnpm lint` and `pnpm test` from the repo root never touch the schema that both `apps/web` and `packages/indexer` depend on; every finding above (missing indexes, journal corruption, dangling FKs) is invisible to CI. `packages/solana-program/package.json:6` is worse: `"test": "echo 'anchor test requires anchor-cli + solana-cli; run directly: anchor test' && exit 0"` reports a green test run while executing nothing, so the 711 lines of Rust in `programs/*/src/lib.rs` and the 471 lines of Mocha tests in `tests/` are never run by `pnpm test`.
**Fix:** Add `"typecheck": "tsc --noEmit"` and a schema-lint script (asserting every FK declares `onDelete`, every `livemode` table includes it in unique keys, every journal entry has a file) to `packages/db`. Change the solana `test` script to `exit 1` with a clear message when the toolchain is absent, or gate it behind an env check so it cannot report false green.
**Effort:** M

### DB-18 — `@paylix/config` and the SDK maintain divergent network-key registries

**Severity:** Low
**File:** `packages/config/src/network-registry.ts:18`
**Problem:** The server-side registry lists 14 EVM keys (`network-registry.ts:18-36`). The SDK's `PaylixNetwork` union (`packages/sdk/src/types.ts:15-35`) lists 20, adding `solana`, `solana-devnet`, `bitcoin`, `bitcoin-testnet`, `litecoin`, `litecoin-testnet` — none of which exist in the config registry. The SDK comment at `types.ts:10-13` states the union "must stay in sync with the server-side registry"; it already is not. Because `assertValidNetworkKey` (`packages/config/src/network-helpers.ts:69-73`) throws for any key not in `NETWORKS`, passing `networkKey: "solana"` from the SDK — a value the SDK's own type system blesses — is rejected server-side, while the SDK constructor (`packages/sdk/src/client.ts:119`) simultaneously rejects any future EVM chain added to the config registry until the SDK is republished.
**Fix:** Pick one source of truth. Extend the config registry with non-EVM entries (with a discriminant so EVM-only helpers can narrow), then generate the SDK union from it via the same codegen step proposed in DB-16. Add a test asserting the two key sets are equal.
**Effort:** M

## Quick Wins

- **SDK-05** — delete the unused `viem` dependency from `packages/sdk/package.json` and `tsup.config.ts`. One-line change, removes a multi-megabyte install from every consumer.
- **SDK-03** — add `"paused"` to the `SubscriptionStatus` union. One line, fixes a live type lie.
- **SDK-08** — add `PaylixNetwork` and `SubscriptionStatus` to the `index.ts` export block. Two lines.
- **SDK-09** (partial) — change `"crypto"` to `"node:crypto"` in `webhooks.ts:1`. One character class, unblocks edge/bundler use.
- **SDK-10** — add `README.md` / `LICENSE` to `files`, add `"sideEffects": false`, add `engines`. Four lines of JSON.
- **DB-02** — add the two missing `_journal.json` entries for 0029/0030 so `db:migrate` stops silently skipping the tax and UTXO columns.
- **DB-05, DB-06, DB-07** — the three keeper/dispatcher/dashboard indexes are pure additions to existing schema files with no data migration risk and immediate, measurable effect.
- **DB-08** — add `uniqueIndex("unmatched_events_dedup_idx")` plus `.onConflictDoNothing()` at `packages/indexer/src/handlers.ts:94`. Small change, closes a duplicate-payment path.
- **DB-09** — promote the `idempotency_keys` unique index to a composite primary key and index `expires_at`.
