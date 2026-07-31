# Requests from the SDK agent to the API agent

Filed while fixing `audit/05-sdk-db.md`. Each item is a route the SDK needs
but that has no handler today. **The SDK does not create API routes** — these
are for whoever owns `apps/web/app/api/**`.

Status: the three methods that called these routes (`listCustomers`,
`getProduct`, `getSubscription`) were **removed from `@paylix/sdk` in
0.1.0**, because they returned HTTP 405 for every caller since publication.
They come back as soon as the handlers below exist. Nothing in the SDK
depends on these landing; this is a feature request, not a blocker.

---

## R1 — `GET /api/customers` (list customers)

**File:** `apps/web/app/api/customers/route.ts` — currently exports `POST` only.

The sibling `POST` handler exists, and `GET /api/customers/[id]` exists, so
the collection read is the only gap. Note both currently authenticate with
`resolveActiveOrg()` (a Better-Auth **session cookie**), not
`authenticateApiKey` — an SDK caller holding an `sk_` key cannot use them at
all. Whatever handler lands should use `authenticateApiKey(request, "secret")`
like `GET /api/payments` does, or the SDK still can't call it.

Suggested shape, mirroring `GET /api/payments`:

```ts
// GET /api/customers?limit=100&email=&customerId=
// → bare array (matches payments/subscriptions), newest first
[
  {
    id, customerId, organizationId, email, firstName, lastName,
    phone, walletAddress, country, taxId, source, metadata,
    deletedAt, createdAt,
  },
]
```

Should exclude soft-deleted rows (`deletedAt is null`) by default and scope
by `livemode`. Related: DB-06 notes `customers` has no index supporting
`organization_id` + `created_at`.

## R2 — `GET /api/products/[id]` (read one product)

**File:** `apps/web/app/api/products/[id]/route.ts` — currently exports
`PATCH` (`:49`) and `DELETE` (`:175`).

`GET /api/products` (the list) already builds exactly the right payload,
including the `prices` join — the single-resource handler should return one
element of that same shape so the SDK's `Product` type covers both:

```ts
{
  id, organizationId, name, description, type, billingInterval,
  trialDays, trialMinutes, isActive, taxRateBps, taxLabel,
  reverseChargeEligible, checkoutFields, metadata, createdAt,
  prices: [{ id, productId, networkKey, tokenSymbol, amount, isActive }],
}
```

`amount` must be stringified, as the list route does (`pr.amount.toString()`).
404 when the product is not in the caller's organization. Same auth note as
R1: the list route is session-auth today.

## R3 — `GET /api/subscriptions/[id]` (read one subscription)

**File:** `apps/web/app/api/subscriptions/[id]/route.ts` — currently exports
`PATCH` only (`:13`).

`GET /api/subscriptions` (the list) is already API-key authenticated and
produces the right row shape; the single-resource handler should return one
of them:

```ts
{
  id, status, subscriberAddress, networkKey, tokenSymbol, onChainId,
  intervalSeconds, nextChargeDate, trialEndsAt, pausedAt,
  productId, productName, metadata, livemode, createdAt,
  customer: { id, email, firstName, lastName, walletAddress },
}
```

`status` must be returned verbatim from the column, including `"paused"` —
the SDK union now includes it (SDK-03).

---

## R4 — `POST /api/payment-links` should return a canonical `url`

**File:** `apps/web/app/api/payment-links/route.ts:102` — returns the bare
row with `{ status: 201 }`.

`createPaymentLink` has to fabricate the shareable URL as
`${backendUrl}/pay/${id}` (SDK-16), which is wrong on any deployment whose
public checkout host differs from the API host, or if the `/pay/` path ever
changes. `createPortalSession` gets this right by returning a server-built
URL.

The SDK now **prefers a server-supplied `url` field** and only falls back to
the derived form, so adding `url` to the response is a drop-in improvement
with no SDK release required:

```ts
return NextResponse.json({ ...row, url: buildPaymentLinkUrl(row.id) }, { status: 201 });
```

## R7 — Three subscription-admin routes need `withIdempotency` (BLOCKING for retries)

**Files:**
- `apps/web/app/api/subscriptions/[id]/extend-trial/route.ts`
- `apps/web/app/api/subscriptions/[id]/comp-charge/route.ts`
- `apps/web/app/api/subscriptions/[id]/reschedule/route.ts`

*(The coordinator is routing this to the API agent separately; recorded here
so the SDK-side workaround has a documented owner and an exit condition.)*

None of the three wrap themselves in `withIdempotency`, so they ignore the
`Idempotency-Key` header. Two of them **accumulate**:

- `extend-trial` adds N days to `trialEndsAt`. Applied twice → 2N free days.
- `comp-charge` inserts a zero-amount `payments` row **and** advances
  `next_charge_date` by one interval. Applied twice → two free billing
  periods and a ledger that no longer reconciles against the keeper.

This does not need a malicious client or even a network fault: a request
that succeeds server-side but whose response is lost to a 504, a proxy
timeout, or the SDK's 30s client timeout is indistinguishable from one that
never arrived, so any retry — automatic or a human clicking twice — applies
it again.

**SDK-side mitigation already shipped** (`packages/sdk/src/admin.ts`): these
three calls set `retry: false` and `idempotencyKey: null`, so the SDK never
replays them and never advertises a guarantee the server does not honour.
That closes the automatic-retry path only. It does **not** protect against
a dashboard double-click, a job runner replaying a failed task, or any
non-SDK client.

**Fix:** wrap all three in `withIdempotency`, as `POST /api/customers`
already is. Then delete the `NO_REPLAY` constant in `admin.ts` and the
three calls inherit normal retry behaviour — please ping the SDK owner when
this lands.

Belt-and-braces worth considering for `comp-charge` specifically: make the
`next_charge_date` advance conditional on the current value (`WHERE
next_charge_date = $expected`), so a concurrent double-apply is rejected by
the database rather than by the wrapper alone.

## R5 — Response-envelope inconsistency (informational)

Noted while mapping the surface; no action required from the SDK side, but
worth a decision before v1:

- `POST /api/customers` → `{ customer: {...} }` (wrapped), status 200.
- `POST /api/products` → bare object, status 201.
- `GET /api/payments`, `/api/subscriptions`, `/api/products` → bare arrays.
- `PATCH /api/subscriptions/[id]` → `{ subscription: {...} }` (wrapped).

The SDK unwraps per-endpoint to hide this. One convention would let it stop.

## R6 — Error envelope (informational)

The SDK now normalizes four different error shapes seen in the wild:
`{ error: "msg" }`, `{ error: { code, message } }`, `{ message }`, and
`{ detail }`. `{ error: { code, message } }` is the richest and the only one
that gives consumers a machine-readable code — standardizing on it would let
`PaylixError.code` be meaningful on every path rather than status-derived.
An `x-request-id` response header would also be surfaced automatically
(`PaylixError.requestId` reads it already).
