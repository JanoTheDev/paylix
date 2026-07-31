# Requests from the `apps/web/lib` + `middleware.ts` agent

Changes I could not make because the file is owned by another agent.
Format: `file:line — what to do`.

---

## A. Duplicate helpers — `app/api/_shared/*` re-implements what now lives in `lib/`

We landed overlapping fixes for the same findings. `lib/` is the shared layer
(`packages/indexer` and the dashboard server components can import it;
`app/api/_shared` they cannot), so please reduce the `_shared` modules to thin
re-exports rather than keeping two implementations of the same security check.

### A1. `app/api/_shared/roles.ts` (API-09) — **blocking a test failure**

`lib/require-active-org.ts` now owns roles. It additionally verifies that the
session's `activeOrganizationId` actually has a `member` row (the session field
is client-influenced state), and attaches `role` to the `resolveActiveOrg()`
result, so the role gate costs **zero** extra queries.

Replace the whole body of `app/api/_shared/roles.ts` with:

```ts
export {
  PRIVILEGED_ROLES,
  OWNER_ONLY,
  ORG_ROLES,
  getOrgRole,
  assertRole as requireRole,
  type OrgRole,
  type RoleResult,
} from "@/lib/require-active-org";
```

`assertRole(ctx, allowed)` has the **same signature and return shape** as your
`requireRole` (`Promise<{ok:true,role} | {ok:false,response}>`), so the 6 call
sites in `keys/route.ts`, `keys/[id]/rotate/route.ts`, `keys/[id]/route.ts`,
`payments/[id]/refund/route.ts`, `refund-requests/[id]/approve/route.ts` and
`subscriptions/gift/route.ts` need **no change**. It reuses `ctx.role` when
`resolveActiveOrg()` already resolved it and only falls back to a lookup
otherwise.

Until this lands, **6 tests in `lib/__tests__/integration/api-keys.test.ts`
fail**: `app/api/_shared/roles.ts` hits `db.select()` directly, and those tests
mock `@/lib/require-active-org` (not `@/lib/db`'s member query). The mocks
already export `assertRole`, so the re-export above turns them green.

Also still ungated (audit named these explicitly under API-09) — please add
`assertRole(ctx, PRIVILEGED_ROLES)`:

- `app/api/settings/route.ts:234` — `merchantPayoutWallets` upsert (this is the
  headline finding: any `member`-role invitee can redirect the merchant's funds)
- `app/api/settings/team/route.ts` — membership changes → `OWNER_ONLY`
- `app/api/user/delete/route.ts` → `OWNER_ONLY`
- `app/api/subscriptions/[id]/comp-charge/route.ts`
- `app/api/refund-requests/[id]/decline/route.ts`

### A2. `app/api/_shared/transfer-logs.ts` (API-03)

`lib/verify-refund.ts` now exports `decodeTransferLogs`, which accepts either
`receipt` or `receipt.logs`. Reduce to:

```ts
export { decodeTransferLogs } from "@/lib/verify-refund";
```

Note mine uses `strict: false` and then drops entries with a missing
`from`/`to`/`value`, so one undecodable log in a receipt cannot make a
legitimate refund unverifiable. Behaviour is otherwise identical.

### A3. `app/api/_shared/token-scale.ts` (API-13)

`lib/amounts.ts` now exports `baseUnitsPerCent(decimals)` and
`nativeUnitsToCents(amount, decimals)`. Reduce `token-scale.ts` to a re-export
of those two plus your `baseUnitsPerCentFor`.

**Behaviour change to adopt:** your version clamps `decimals < 2` to `1n`; mine
throws. A token that cannot represent a cent must not silently get a 100×-wrong
scale in refund verification — please take the throwing version.

### A4. `app/api/_shared/client-ip.ts` (API-34)

`lib/client-ip.ts` exports `getClientIp(request): string` (rightmost-trusted-hop
walk, `TRUSTED_PROXY_HOPS`, plus `cf-connecting-ip` / `x-real-ip` /
`true-client-ip` fallbacks, IPv4-port and `::ffff:` normalisation). Suggest:

```ts
import { getClientIp } from "@/lib/client-ip";
export const clientIpKey = getClientIp;
export const clientIp = (r: Request) => {
  const ip = getClientIp(r);
  return ip === "unknown" ? null : ip;
};
```

`lib/portal-auth.ts` imports `getClientIp`, so `lib/client-ip.ts` has to stay
regardless — please don't leave two IP parsers in the tree.

Two behaviours in `lib/client-ip.ts` that yours does not have, and that you
should inherit rather than re-derive:

1. **`TRUSTED_PROXY_HOPS=0` returns `"unknown"`.** Yours coerces `n < 1` to the
   default of 1. With nothing in front of the process the *entire* forwarding
   chain — rightmost entry included — plus `cf-connecting-ip` / `x-real-ip` /
   `true-client-ip` are all client-supplied and forgeable, so trusting any of
   them re-creates API-34 (a fresh rate-limit bucket per request, poisoned
   `audit_logs.ip_address`).
2. **Values are validated as IPv4/IPv6 literals**, capped at 1 KB per entry,
   and only the rightmost `hops + 16` entries are parsed. Otherwise a 2 KB junk
   `X-Forwarded-For` becomes a rate-limit bucket key.

### A5. `app/api/_shared/webhook-send.ts` (API-11 / API-24)

`lib/webhook-dispatch.ts` now exports `deliverWebhook({ webhook, event,
envelope, deliveryId?, attempt? })`, which does **all** of: sign
(`signWebhookPayload`), insert/patch the `webhook_deliveries` row (with
`livemode`), re-run `validateWebhookUrl` immediately before the request, fetch
with `redirect: "manual"` + a 10 s `AbortSignal.timeout`, treat any 3xx as
`redirect_not_followed`, and never surface the raw fetch error (it can echo the
resolved internal host back to an SSRF prober).

Please point all four senders at it and drop `sendWebhookRequest`:

- `app/api/webhooks/[id]/send-test/route.ts:86-142`
- `app/api/webhooks/deliveries/[id]/replay/route.ts:54-110` — pass the existing
  row via `deliveryId` and `attempt: existing.attempts + 1`
- `app/api/webhooks/[id]/test/route.ts:50-87` — audit API-35 says delete this
  route outright
- (`lib/webhook-dispatch.ts` itself already uses it)

Header casing is now uniformly `x-paylix-signature` and every delivery row gets
`livemode`.

---

## B. Call-site changes required by signature changes in `lib/`

### B1. `lib/wallet-activity.ts` — `checkWalletActivity` takes `rpcUrl` (API-28)

The old code read `process.env.RPC_URL`, which is **not set anywhere in this
repo**, so viem silently fell back to the public RPC and the "wallets with zero
on-chain history are blocked from trials" control was effectively off. The
parameter is optional (nothing breaks today) but it warns when omitted:

- `app/api/checkout/[id]/relay/route.ts:286` — add
  `rpcUrl: resolveDeploymentForMode(session.livemode).rpcUrl` to the
  `checkWalletActivity({...})` call (the deployment is already resolved in this
  handler).
- `app/api/checkout/[id]/trial-eligibility/route.ts:60` — same, using
  `session.livemode`.

All fail-open branches now log a `console.warn` so the degradation is visible.

### B2. `lib/api-auth.ts` — `requiredType` now defaults to `"secret"` (API-20)

`authenticateApiKey(request, requiredType = "secret", routeLimit?)`. The prefix
is now parsed and must agree with the stored row on **both** capability and
mode; an unrecognised prefix is rejected outright.

- `app/api/test/faucet/route.ts:12` — currently passes `undefined` as
  `requiredType`, which used to accept a `pk_test_` key. It now resolves to
  `"secret"`, which is the fix API-20 asks for. **Please replace `undefined`
  with an explicit `"secret"`** so the intent is readable at the call site.
  If the faucet is meant to stay client-callable, pass `"publishable"` *and*
  add a per-IP limit — but the audit says it should not be.

### B3. `lib/webhook-dispatch.ts` — `dispatchWebhooks` takes `livemode` (4th arg)

Webhook fan-out was not mode-scoped: a test-mode event was delivered to live
endpoints. The parameter is optional so existing calls compile, but **please
pass it at all 11 call sites** (`relay/route.ts:435` and `:826`,
`payments/[id]/refund/route.ts:196`, `portal/cancel-trial/route.ts:68`,
`portal/refund-requests/route.ts:70`,
`refund-requests/[id]/approve/route.ts:168` and `:177`,
`refund-requests/[id]/decline/route.ts:59`, `subscriptions/gift/route.ts:135`,
`subscriptions/[id]/cancel/route.ts:117`,
`subscriptions/[id]/cancel-trial/route.ts:65`).

---

## C. New helpers available — please adopt

### C1. `lib/portal-tokens.ts` — `signUnsubscribeToken` / `verifyUnsubscribeToken` (API-02)

- `app/api/public/unsubscribe/route.ts:9` — delete the module-level
  `const SECRET = ... ?? ""` and the local `verify()` (lines ~18-38). An empty
  HMAC key makes every unsubscribe token forgeable. Replace with:

```ts
import { verifyUnsubscribeToken } from "@/lib/portal-tokens";
const result = verifyUnsubscribeToken(token, ALLOWED);
if (!result) return /* existing 401/400 */;
```

  Same `PORTAL_TOKEN_SECRET ?? BETTER_AUTH_SECRET` resolution as today, but it
  throws instead of falling back, enforces a 32-char minimum, and the digest
  comparison rejects malformed hex before `timingSafeEqual`.
- Wherever unsubscribe links are generated (mailer templates / notification
  senders), switch to `signUnsubscribeToken(customerId, category)`.

**Portal token behaviour change:** `signPortalToken` now *throws* when
`BETTER_AUTH_SECRET` is unset or shorter than 32 chars, and
`verifyPortalToken` returns `false` in that case (deny, with a
`[portal-tokens]` console error). The hardcoded
`"paylix-portal-fallback-secret"` is gone. `app/api/customers/[id]/portal-url/route.ts:48`
should catch the throw and return a 500 with a config-error code rather than
letting it 500 unhandled.

### C2. `lib/portal-auth.ts` — `requirePortalCustomer` / `requireOwnedSubscription` (API-26)

Replaces the 11 hand-rolled `verifyPortalToken` + ownership blocks. Reads the
token from the query string first, then an already-parsed body; applies a
60/min per-IP limit; returns one generic `invalid_token` 401 for every failure
mode so the endpoints stop being customer-id oracles.

```ts
const portal = await requirePortalCustomer(request, body);
if (!portal.ok) return portal.response;
const owned = await requireOwnedSubscription(portal.customerId, subscriptionId);
if (!owned.ok) return owned.response;
const sub = owned.subscription;
```

Ownership is now part of the SQL `WHERE` (not a post-hoc JS compare) and a
non-owned subscription returns **404, not 403** — "exists but isn't yours" is
itself information.

Apply to: `portal/cancel-trial/route.ts:29-54`,
`portal/cancel-subscription/route.ts:31-51`, `portal/[customerId]/route.ts:23`
(use `requirePortalCustomerId`), `portal/invoices/route.ts:11`,
`portal/refund-requests/route.ts:33` and `:97`, `portal/wallets/route.ts:23`
and `:40`, `portal/subscriptions/[id]/backup-payer/route.ts:46-69`
(this one's redundant double-`eq` on the same column goes away),
plus `cancel-at-period-end`, `pause-subscription`, `resume-subscription`,
`resume-schedule` and `notifications`.

### C3. `lib/verify-refund.ts` — hardened input validation

`verifyRefund` now returns `invalid_amount` for non-integer / non-finite /
negative `refundCents`, `refundedCents`, `amountCents`, and for
`baseUnitsPerCent <= 0n`, instead of letting `BigInt()` throw a 500 inside the
handler. No call-site change needed; you may be able to drop a manual check.

---

## D0. Contract ABI update (SC-01 backup-payer consent) — call sites now failing tsc

`apps/web/lib/contracts.ts` has been updated to the post-SC-01 contracts and is
pinned to `packages/contracts/abi/*.json` by
`lib/__tests__/contracts-abi.test.ts`. **This is one atomic change with the
redeploy — do not add a shim that supports both ABIs.**

`tsc` now reports 8 errors, all at stale call sites. Each is the fix:

### `app/api/checkout/[id]/relay/route.ts`

- `:676` `createSubscriptionWithPermit2` — add `maxFeeBps` (after `customerId`,
  before `deadline`).
- `:711` `createSubscriptionWithPermitDiscount` — add `maxFeeBps` (after
  `discountCycles`, before `deadline`).
- `:736` `createSubscriptionWithPermit` — add `maxFeeBps` (after `permitValue`,
  before `deadline`).
- `:762` `createPaymentWithDaiPermit` — add `maxFeeBps` (after `customerId`).
- `:787` `createPaymentWithPermit2` — add `maxFeeBps` (after `customerId`).
- `:808-809` `createPaymentWithPermit` — **signature reshaped**, no longer flat.
  It is now `(PaymentIntentData d, PermitSig permitSig, bytes intentSignature)`.
  Note the field order inside `d`: **`buyer` comes before `token`**, the
  opposite of every other params struct — it mirrors the EIP-712 typehash.

  ```ts
  args: [
    { buyer, token, merchant, amount, productId, customerId, maxFeeBps, deadline },
    { deadline, v, r, s },   // permitSig.deadline MUST equal d.deadline
    intentSignature,
  ]
  ```

  The contract enforces `d.deadline == permitSig.deadline` ("Deadline
  mismatch"). Derive it once with `signatureDeadline(seconds)` from
  `@/lib/contracts` and pass the same value to both — two separate
  `Date.now()` reads can land a one-second skew that reverts.

`maxFeeBps` must be the ceiling the buyer actually signed, read back from the
stored intent — not `platformFee` re-read at relay time. Re-reading it defeats
SC-03: the point is that an owner fee raise cannot reprice an already-signed
intent.

### `app/api/portal/subscriptions/[id]/backup-payer/route.ts:88`

Two changes:

1. The params struct gained `maxAmount` and `consentDeadline`:
   `{ subscriptionId, backup, authDeadline, maxAmount, consentDeadline, permitValue, permitDeadline, v, r, s }`.
2. A **third argument**, `backupConsentSig` — an EIP-712 `BackupPayerConsent`
   signed by the backup wallet itself. This is the Critical: an ERC-20
   allowance is spending power, not agreement to fund subscription N, and the
   permit that used to be the only gate was swallowed by a `try/catch`. The
   route must accept and forward this signature; it cannot be synthesised
   server-side.

   ```
   BackupPayerConsent(uint256 subscriptionId,address subscriber,address token,uint256 maxAmount,uint256 nonce,uint256 deadline)
   ```

**Nonce getters are three separate counters** — using the wrong one produces a
signature the contract cannot verify:

| Signature | Getter | Keyed by |
|---|---|---|
| `SubscriptionIntent` / `...Discount` | `getIntentNonce` | buyer |
| `BackupPayerAuth` | `getBackupAuthNonce` | subscriber |
| `BackupPayerConsent` | `getBackupConsentNonce` | backup wallet |

All three are now in `SUBSCRIPTION_MANAGER_ABI`. Whatever builds the
BackupPayerAuth signature must switch from `getIntentNonce` to
`getBackupAuthNonce`.

### For the `packages/indexer` agent

`packages/indexer/src/trial-converter.ts:6-33` carries its **own inline copy**
of `createSubscriptionWithPermit` and it is stale — the tuple is missing
`maxFeeBps`, so every trial conversion will fail to encode after the redeploy.
It is outside my ownership. Either add `maxFeeBps` after `permitValue`, or
better, delete the local copy and import `SUBSCRIPTION_MANAGER_ABI`. Note the
stored `pendingPermitSignature` rows must also carry the `maxFeeBps` the buyer
signed at checkout, or the replayed intent will not verify — that is a
`packages/db` schema question (see below).

### Also exported from `lib/contracts.ts` for reuse

- `FLOW_EIP2612` / `FLOW_PERMIT2` / `FLOW_DAI_PERMIT` — `flow` is not a
  calldata field, but it **is** in the EIP-712 typehash, so every off-chain
  signer must include `uint8 flow` with the matching value.
  `app/checkout/[sessionId]/checkout-client.tsx:89` declares its own local
  `FLOW_EIP2612 = 1`; please import from `@/lib/contracts` instead so the two
  cannot drift.
- `ON_CHAIN_SUBSCRIPTION_STATUS` — `{ None: 0, Active: 1, PastDue: 2,
  Cancelled: 3 }`. `Expired` is gone; nothing ever assigned it. These are the
  chain's values and are deliberately distinct from the `subscriptions.status`
  text column ("active", "past_due", "cancelled", "trialing") — don't index one
  with the other.
- `signatureDeadline(seconds)` — see above.
- `subscriptionMaxFeeBps(id)` view, for showing a subscriber the ceiling they
  actually signed.

---

## D1. REPO-18 second half — WalletConnect project id (done, one follow-up)

`apps/web/lib/wagmi.ts:24` no longer falls back to the hardcoded live project
id. It now throws at module load naming
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` and pointing at
https://dashboard.reown.com, and rejects the `.env.example` placeholder too so
an operator who copies the file verbatim gets the same clear error rather than
a broken wallet connect at checkout.

Deliberately **not** format-validated as 32-hex:
`.github/workflows/web-test.yml:84` sets `ci-stub-project-id`, which a format
check would reject and which I cannot edit. Absent/placeholder is the fail-closed
condition; anything else is passed through.

The literal `<redacted — see git history, rotate this credential>` appeared exactly once in the tree
(that fallback) and is now gone — `.env.example:78` was already fixed by the
tooling agent. Two follow-ups outside my ownership:

1. **Rotate the id.** It is in this repo's git history and in
   `.env.bak.*` files at the repo root, so it is public regardless of the source
   fix. `wagmi.ts` logs a `console.error` if that specific id is ever supplied
   via env, but only the owner can revoke it at dashboard.reown.com.
2. `docs/superpowers/plans/2026-04-10-paykit-plan-6-checkout.md:289` still shows
   `process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "placeholder"` as the
   recommended pattern. Historical planning doc, but it is the pattern that
   produced the leak — worth a note if that file is being maintained.

---

## D. Schema requests (for the `packages/db` agent)

- **API-01** — `checkout_sessions.livemode`, `customers.livemode`,
  `product_prices.livemode`, `subscriptions.livemode`: drop
  `.default(false)` while keeping `.notNull()`, so Drizzle's insert type forces
  every call site to supply it. That is the repo-wide guard the audit asks for;
  adding the field to six inserts without it just waits for the seventh.
- **API-16** — keep/add the unique index on `refunds.tx_hash` as the hard
  duplicate guard once the query is org-scoped.
- **API-25** — `webhook_deliveries` already has `attempts` and `next_retry_at`;
  nothing new needed for a retry sweep, but nothing writes `next_retry_at`
  today.
- **SC-01/SC-03 (contracts)** — `subscriptions.pendingPermitSignature` (replayed
  by `packages/indexer/src/trial-converter.ts`) must now also store the
  `maxFeeBps` the buyer signed at checkout. Without it the converter cannot
  reconstruct the `SubscriptionIntent` digest and every trial conversion fails
  signature verification after the redeploy.

---

## E. Findings in my scope I did **not** fix (out of file ownership)

- **API-04** (Critical, `app/api/checkout/[id]/route.ts:107`) — unauthenticated
  PATCH that can rewrite `amount`. Entirely inside a route file.
  `lib/tax-rates.ts` is now overflow-safe (API-14) so the recompute can no
  longer be driven to zero via int32 wraparound, but the endpoint still needs
  auth, state guards and a zod schema with `.max()` on every string.
- **API-05**, **API-06**, **API-17** — relay route / `relay/dedup.ts`.
- **API-07**, **API-08** — response projections.
- **API-10** — SVG upload.
- **API-18**, **API-19**, **API-21**, **API-23** — unauthenticated checkout
  sub-routes.
- **API-33** — `user/delete`.
