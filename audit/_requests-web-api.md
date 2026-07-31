# Requests from the `apps/web/app/api` agent

Changes I could not make because the file is owned by another agent.
Format: `file:line — what to do`.

---

## A. Breaking API changes that need a caller update

### A1. `POST /api/user/delete` now requires a confirmation body (API-33)

`app/(dashboard)/user/settings/page.tsx:143` currently does
`fetch("/api/user/delete", { method: "POST" })` with **no body**. That call now
returns `400 { error: { code: "confirmation_required" } }`.

Send the signed-in user's own email back as confirmation:

```ts
await fetch("/api/user/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ confirmEmail: user.email }),
});
```

Ideally the UI asks the user to *type* it — the point of the finding is that a
one-click hard delete with no confirmation and no audit trail is too easy to
fire accidentally or via a stray POST.

Two new failure codes the dialog should surface:
- `confirmation_required` (400) — body missing or email doesn't match.
- `sole_owner` (409) — the user is the only `owner` of a team; they must
  transfer ownership or delete the team first.

### A2. Role-gated endpoints now 403 for `member`-role users (API-09)

`assertRole(ctx, PRIVILEGED_ROLES)` gates these; a `member` gets
`403 { error: { code: "forbidden" } }` where they previously got a 200:

- `POST /api/keys`, `DELETE /api/keys/[id]`, `POST /api/keys/[id]/rotate`
- `POST /api/payments/[id]/refund`
- `POST /api/refund-requests/[id]/approve`, `.../decline`
- `POST /api/subscriptions/gift`
- `POST /api/subscriptions/[id]/comp-charge`
- `PATCH /api/settings` **when the body contains `networks`** (the payout-wallet
  upsert; the rest of the settings body is still member-writable)

Dashboard should hide or disable those controls for non-privileged members
rather than letting them click into a 403. `GET /api/settings/team` already
returns an `isOwner` flag; `resolveActiveOrg()` now carries `role`, so a server
component can read it directly.

### A3. `PATCH|POST /api/checkout/[id]` response shape (API-04)

Was: the full `checkout_sessions` row on a status update, or `{ ok: true }` on a
customer-form-only update. Now always the same tight projection:

```
{ ok: true, id, status, amount, subtotalAmount, taxAmount, taxRateBps, taxLabel }
```

`app/checkout/[sessionId]/checkout-client.tsx:378-390` only reads `patched.amount`,
so it keeps working. Buyer PII is no longer echoed back to an anonymous caller.

New failure codes the checkout client may now see (all pre-existing states that
used to be silently writable):
- `invalid_state` (409) — session is completed/expired/abandoned
- `relay_in_flight` (409) — a payment is being submitted
- `session_expired` (410)
- `rate_limited` (429) — 60/min per IP, 20/min per session

`apply-coupon` (POST **and** DELETE) and `pick-currency` gained the same
`relay_in_flight` / `invalid_state` guards, plus `rate_limited` on apply-coupon.
`apply-coupon` no longer distinguishes "no such code" from "code invalid" — both
are `coupon_invalid` (409), so the endpoint stops being a coupon enumerator. If
the UI shows different copy for the two, collapse it to one message.

### A4. `POST /api/upload/logo` no longer accepts SVG (API-10)

`image/svg+xml` is out of the allowlist and the format is now decided by magic
bytes, not the client-supplied `file.type`. PNG / JPEG / WebP only; anything
else is `415 unsupported_file_type`. A logo picker with `accept="image/svg+xml"`
should drop it. Also `429 rate_limited` at 10 uploads/min/user.

### A5. `POST /api/test/faucet` no longer accepts `pk_` keys (API-20)

Publishable keys are rejected (401). Any SDK sample or doc showing the faucet
called with a `pk_test_` key needs updating to `sk_test_`. Also 10/min per IP on
top of the per-key limit.

---

## A7. SC-01 backup payer — payload the portal UI must send

`POST /api/portal/subscriptions/[id]/backup-payer` now requires the backup
wallet's own EIP-712 consent. **Until the portal UI collects it, this endpoint
returns `400 validation_failed`** — which is the correct interim state: the
alternative is submitting a transaction that reverts on-chain with "Bad backup
consent".

Request body (all fields required):

```jsonc
{
  "customerId":        "<uuid>",          // portal auth
  "token":             "<portal token>",  // portal auth
  "backup":            "0x…40 hex",
  "subscriberAuthSig": "0x…130 hex",      // BackupPayerAuth, signed by the SUBSCRIBER
  "authDeadline":      1730000000,        // unix seconds
  "backupConsentSig":  "0x…130 hex",      // BackupPayerConsent, signed by the BACKUP WALLET
  "maxAmount":         "5000000",         // per-charge cap, token native units, decimal string
  "consentDeadline":   1730000000,        // unix seconds
  "permitValue":       "60000000",        // EIP-2612 allowance, decimal string
  "permitDeadline":    1730000000,        // unix seconds
  "v": 27, "r": "0x…64 hex", "s": "0x…64 hex"   // EIP-2612 permit from the BACKUP wallet
}
```

### The two signatures use different signers and different nonce counters

| Signature | Signer | Nonce getter | Keyed by |
|---|---|---|---|
| `BackupPayerAuth` | primary subscriber | `getBackupAuthNonce` | subscriber |
| `BackupPayerConsent` | **backup wallet** | `getBackupConsentNonce` | **backup wallet** |

Using `getIntentNonce` for either yields an unverifiable signature. These are
three distinct counters — verified at `SubscriptionManager.sol:1078`
(`backupAuthNonces[subscriber]`) and `:1105` (`backupConsentNonces[p.backup]`).

Typehashes, quoted from `packages/contracts/src/SubscriptionManager.sol:56-68`:

```
BackupPayerAuth(uint256 subscriptionId,address backup,uint256 nonce,uint256 deadline)
BackupPayerConsent(uint256 subscriptionId,address subscriber,address token,uint256 maxAmount,uint256 nonce,uint256 deadline)
```

**`subscriber` and `token` in the consent digest are read from the on-chain
subscription by the contract** (`_verifyBackupConsent` is called with
`sub.subscriber` and `sub.token`, `:1168`), not from the request. Build the
typed data from the same on-chain values or the digest won't reproduce.

### Server-side bounds the UI should pre-check to avoid a wasted signature

All can only reject — `maxAmount` is inside the consent digest and is
forwarded verbatim, never adjusted:

- `maxAmount > 0`, and `permitValue >= maxAmount` (both mirror contract requires)
- `permitValue <= 12 × maxAmount` — `maxAmount` is a **per-charge** cap, so
  after N missed cycles a merchant can pull N × maxAmount in one block. The
  contract has no lifetime cap, so the allowance is bounded here instead. A
  wallet consenting to cover one cycle should not be signing an unlimited
  approval. Surface this in the UI as the number of cycles being covered.
- all three deadlines must be in the future and within 1 hour.

---

## A8. `maxFeeBps` is stamped on the session, and served two ways

`checkout_sessions.max_fee_bps` (nullable integer, bps, `CHECK 0..1000`) is
written at **three** points, all strictly before the buyer is asked to sign:

| Where | When |
|---|---|
| `app/api/checkout/route.ts` | session creation (SDK) |
| `app/api/checkout-links/route.ts` | session creation (dashboard link) |
| `app/api/checkout/[id]/pick-currency/route.ts` | currency lock |

Creation always stamps a value, so the column is never null on a new session.
`pick-currency` re-stamps it because that endpoint *is* the quote for a session
created without a currency — it is where the amount the buyer signs over is
finally decided, and a session can sit in `awaiting_currency` for a while. It
is safe to re-stamp there: the handler already rejects once `relayInFlightAt`
is set or the session leaves an open status, so it can never run against a
session that is being paid. **Nothing writes it at signing time** — that would
reopen the race SC-03 closes.

Exposed on `GET /api/checkout/[id]` as `maxFeeBps` (integer bps, or `null`).
The checkout page must pass the same value into the `session` prop so the two
cannot disagree.

The relay reads it from the session row. It is deliberately **not** accepted in
the relay POST body — a client-chosen ceiling is worthless, since the entire
purpose is to protect the buyer from a fee raise. If you would prefer to echo
it for an equality assertion, say so and I will add one, but the session
remains the source of truth.

The relay additionally performs a *sanity check* in exactly the form the
contract enforces — `platformFee() <= session.maxFeeBps` — and returns
`409 fee_above_signed_max` if an owner fee raise has voided the signature.
That is SC-03 working as designed, and it gives the buyer a readable error
instead of an opaque on-chain revert. A fee *drop* still settles, matching
`_feeBpsFor`, which clamps downward only. The read is a check, never a source:
a failure to read it is logged and deferred to the chain rather than blocking a
payment the contract would accept.

Sessions created before this column existed have `max_fee_bps = NULL` and are
rejected by the relay with `409 fee_ceiling_missing` — they predate the
signing scheme and cannot produce a verifiable intent. Surface that as "start a
new checkout".

### Trial snapshots carry the ceiling too

`pendingPermitSignature.intent` now stores `maxFeeBps` (decimal string) and
`flow` (number). The trial converter must replay the stored `maxFeeBps`
verbatim; recomputing it at conversion time would break the digest whenever the
fee changed during the trial. `flow` is stored defensively so the converter can
refuse to replay a Permit2-signed intent through the EIP-2612 entry point —
it must never enter the calldata struct. Filed against
`audit/_requests-indexer-evm.md` §3b.

**`flow` is not sent to the API at all.** It is not a calldata field on any
contract function — each entry point passes its own constant internally
(`PaymentVault.sol:244,351,423`; `SubscriptionManager.sol:360,443,611`). It
exists only inside the EIP-712 typehash, so only the *signer* needs it.
`SubscriptionManager` has just `FLOW_EIP2612 = 1` and `FLOW_PERMIT2 = 2` —
there is **no** `FLOW_DAI_PERMIT` there, because no DAI-permit subscription
path exists.

---

## B. For the `packages/db` agent

Same as section D of `_requests-web-lib.md`; restating the one that matters most
to this layer:

- **API-01** — drop `.default(false)` (keep `.notNull()`) on `livemode` in
  `checkout_sessions`, `customers`, `product_prices`, `subscriptions`. I added
  `livemode` to all six inserts the audit named, but without removing the column
  default nothing stops the seventh insert from silently landing in test mode.
  Drizzle's insert type is the only durable guard here.

---

## C. For the `apps/web/lib` agent

- **Header regression from adopting `deliverWebhook`.** The shared sender emits
  a fixed header set, so `x-paylix-test: 1` (send-test) and `x-paylix-replay: 1`
  (replay) are no longer sent. The test envelope still carries
  `livemode: false` + an `evt_test_*` `event_id`, and the replay reuses the
  original envelope, so receivers can still tell — but if those headers are
  documented, `deliverWebhook` needs an optional `headers` passthrough.
- **`app/api/settings/route.ts` payout wallets: the Solana/UTXO branches are
  dead.** `assertValidNetworkKey` only accepts the EVM union, so it rejects
  `solana` / `bitcoin` / `litecoin` before the per-family address validation
  below it can run. Pre-existing (the old code hid it behind an implicit `any`);
  surfaced by adding a zod schema. Either the registry needs those keys or the
  branches should go.
- **`user/delete` was not gated with `OWNER_ONLY`** as `_requests-web-lib.md §A1`
  suggested: it deletes the caller's *own* account, so requiring org-ownership
  would stop a plain member from ever leaving. The sole-owner refusal + audit
  record cover the actual risk the finding describes.
- **`lib/idempotency.ts` ignores `livemode`.** `idempotency_keys` has the
  column, but every read/write scopes on `(organizationId, key)` and the INSERT
  never sets it. The PK is `(organization_id, key)`, so this can't be fixed
  from a call site — a test-mode and a live-mode POST sharing an
  `Idempotency-Key` collide and the second caller is served the first's cached
  response. `withIdempotency` now wraps ~15 mutating routes, including the
  three I just added, so the blast radius grew.

---

### A6. UTXO networks are rejected server-side while the flag is off

`NEXT_PUBLIC_ENABLE_UTXO_PAYMENTS` is read server-side in three routes, using
`app/_lib/utxo-payments.ts` so the buyer/merchant copy can't drift from the UI:

- `POST /api/checkout/[id]/pick-currency` → `409 network_unavailable` +
  `UTXO_BUYER_NOTICE`
- `POST /api/checkout` (pre-locked currency) → `409 network_unavailable` +
  `UTXO_MERCHANT_NOTICE`
- `PATCH /api/settings` (payout `networks[]`, **`enabled: true` only**) →
  `409 network_unavailable` + `UTXO_MERCHANT_NOTICE`

Disabling a UTXO network stays allowed, so a merchant who already turned one on
can back it out. In both `pick-currency` and `settings` the gate is placed
*before* `assertValidNetworkKey`, which only accepts the EVM union and would
otherwise mask the real reason behind a generic `invalid_network_key`.

I did **not** implement fiat-rate capture — the price source, per-org
configurability and quote-expiry policy are open product questions, and the
requirements are already written up in `_requests-web-pages.md`.

---

## D. Findings in my scope left open

### API-25 — webhooks are delivered inline, once, with no retry (Medium). NOT TAKEN.

**Owner needed: the `packages/indexer` agent.** Nothing further is fixable in
the route layer.

Key references:
- `apps/web/lib/webhook-dispatch.ts` — `deliverWebhook` sets `attempts` from
  its `attempt` arg (default `1`) and nothing ever re-reads
  `status = 'failed'`, so a single transient 502 loses the event permanently.
- `dispatchWebhooks` is called as **`void dispatchWebhooks(...)`** at all 11
  call sites — `checkout/[id]/relay/route.ts:549` and `:850`,
  `payments/[id]/refund/route.ts:224`, `portal/cancel-trial/route.ts:68`,
  `portal/refund-requests/route.ts:70`,
  `refund-requests/[id]/approve/route.ts:202` and `:211`,
  `refund-requests/[id]/decline/route.ts:60`,
  `subscriptions/gift/route.ts:133`, `subscriptions/[id]/cancel/route.ts:118`,
  `subscriptions/[id]/cancel-trial/route.ts:66`. On a serverless runtime the
  work is cancelled the moment the response is returned.
- `packages/db/src/schema/webhook-deliveries.ts` already has `attempts` and
  `next_retry_at`; **nothing writes `next_retry_at`.**

Suggested shape: keep writing the `pending` row synchronously (already the
case), and have the indexer's existing keeper loop own a sweep over
`status = 'failed' AND next_retry_at <= now()` with exponential backoff on
`attempts` and a cap.

### API-27 — portal tokens travel in URL query strings and live 30 days (Medium). NOT TAKEN.

**Owner needed: the `apps/web/app` pages agent**, coordinated with whoever
owns `lib/portal-tokens.ts` for the TTL.

Key references:
- Link is generated at `app/api/customers/[id]/portal-url/route.ts:64` as
  `${baseUrl}/portal/${customer.id}?token=${token}`.
- `lib/portal-auth.ts:49-51` (`requirePortalCustomer`) and `:90-92`
  (`requirePortalCustomerId`) read `searchParams.get("token")` first, then a
  body field.
- TTL lives in `lib/portal-tokens.ts`; there is no revocation path.

Query strings land in access logs, proxy logs, browser history and the
`Referer` header of any outbound link on the portal page.

The API side is now ready for this: all 13 portal routes go through
`requirePortalCustomer` / `requirePortalCustomerId`, so adding a cookie read
is a change in **one file** (`lib/portal-auth.ts`) rather than 13. What is
still missing is the portal *page* performing a one-time exchange of the link
token for an httpOnly cookie, then stripping the token from the URL. The
shape in `app/api/_shared/checkout-token.ts` ports directly — but note the
caveat below about not putting the secret in the URL in the first place.
- **API-04, residual gap in the per-session token.** `PATCH /api/checkout/[id]`
  now requires an httpOnly, `SameSite=Strict` cookie (`_shared/checkout-token.ts`)
  for any write carrying buyer details — the PII the trial dedup keys on, and
  the `country` that drives the tax recompute and therefore the charged total.
  The cookie is minted on `GET /api/checkout/[id]`, which every load of the
  checkout page performs, so no client change was needed.

  **What it does not stop:** the token is *derived* from the session id, not
  stored, so an attacker holding a leaked link can still script GET-then-PATCH
  and obtain a valid cookie. It closes drive-by and cross-site writes (the
  middleware exempts `/api/checkout` from the Origin check, so `SameSite` is
  now the only thing standing there) and it keeps the token out of
  `document.cookie` — but it is not equivalent to a secret issued at session
  creation.

  Concretely, anyone holding the link can `GET /api/checkout/<id>` to mint a
  valid cookie and then PATCH with it, which still allows:
  - overwriting `buyerEmail` / `buyerFirstName` / `buyerLastName` /
    `buyerPhone` / `buyerCountry` / `buyerTaxId` on a pending session
    (`checkout/[id]/route.ts:270-276`), which is then upserted onto the
    merchant's `customers` row (`:302-319`) — so receipts and portal links
    follow the attacker's address; and
  - moving the charged total by supplying a zero-VAT `country`, since
    `computeTaxPatch` writes `amount` at `:435`/`:446`.

  #### Agreed fix — do this, and do not relitigate the alternative

  **`checkout_sessions.client_secret`**, and specifically:

  1. **db agent** — add `client_secret text not null` to
     `packages/db/src/schema/checkout-sessions.ts`, generated at insert
     (`randomBytes(32).toString("base64url")`).
  2. **api (me)** — return it **once** in the `POST /api/checkout` response
     (`checkout/route.ts`), alongside `checkoutUrl`/`checkoutId`.
  3. **pages agent** — the checkout server component
     (`app/checkout/[sessionId]/page.tsx`) reads it from the DB and injects it
     into the page body (props / a non-public script payload).
  4. **api (me)** — require it on `PATCH|POST /api/checkout/[id]`, replacing
     the derived cookie in `_shared/checkout-token.ts`.

  **It must never appear in the URL.** That is the whole point — a secret in
  the query string reproduces API-27 (access logs, proxy logs, browser
  history, `Referer` on any outbound link) on the checkout page, which is
  exactly the flaw being fixed. Server-render it into the body instead.

  **Rejected alternative — single-claim binding on `viewedAt`.** Mint the
  cookie only on the first GET and stamp the claim so later arrivals get
  nothing. Do **not** pursue this:
  - an attacker who GETs first simply wins the race, which converts an
    integrity bug into a **lockout denial of service** against the legitimate
    buyer — strictly worse than what it replaces;
  - it breaks ordinary page reloads and multi-tab;
  - it breaks cross-device checkout (open on desktop, pay on phone).

  This needs the user's sign-off before anyone starts, since it spans the db
  and pages agents.

  Separately, **the total is now derived, not caller-set**: `amount` is only
  ever written as `subtotalAmount - discount + serverComputedTax`, where
  `subtotalAmount` is the snapshotted merchant price and the rate comes from
  `lib/tax-rates.ts`. No request field reaches `amount`, `subtotalAmount` or
  `discountCents`. The residual influence is that `country` is buyer-declared —
  inherent to VAT, and gated behind the cookie today, behind `client_secret`
  once the above lands.
