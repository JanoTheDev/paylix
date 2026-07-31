# Requests from the `apps/web/app/**` (pages) agent

Changes required in files I do not own. Filed against `audit/02-web-ui.md`.

## Critical / High

- `apps/web/lib/format.ts:41` — **UI-02.** `const EXPLORER_BASE = "https://sepolia.basescan.org"` is hard-pinned.
  Replace with a lookup against the `NETWORKS` registry in `@paylix/config/networks`, e.g.
  `explorerUrl(kind: "tx" | "address", value: string, networkKey?: NetworkKey)` defaulting to
  `NETWORK_KEY` from `apps/web/lib/chain.ts`. There are no explorer links inside `apps/web/app/**`
  (non-API), so nothing on my side blocks this — but every table link is wrong until it lands.
- `apps/web/components/paykit/hash-text.tsx:20` and `apps/web/components/paykit/address-text.tsx:20` —
  **UI-02.** Thread a `networkKey` prop through to the new `explorerUrl` signature, and through
  `col.hash` / `col.address` in `apps/web/components/paykit/columns.tsx`.

## Medium (in components/, blocked for me)

- `apps/web/components/paykit/columns.tsx` — **UI-07.** Add a `col.nativeAmount(key, header, { decimalsKey, symbolKey })`
  builder that calls `formatNativeAmount` from `@/lib/amounts`. Any column sourced from
  `checkout_sessions.amount` is **native token units, not cents** — `col.amount` divides by 100 and is
  wrong for it. I worked around this with a local `nativeAmountColumn` in
  `apps/web/app/(dashboard)/checkout-links/page.tsx`; please fold it into `col` and have me delete the local copy.
- `apps/web/components/paykit/amount.tsx:33` — **UI-26.** `UsdcPill` hardcodes the literal `USDC`.
  Add `symbol?: string` to `AmountProps` and render `<UsdcBadge symbol={…} />`.
- `apps/web/components/paykit/status-badge.tsx:88` — **UI-25.** Wrapper should be
  `rounded-full px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.3px]` (DESIGN.md §4 Badges).
  `STYLES.cancelled` must move onto the destructive tokens (`bg-destructive-muted text-destructive
  border-destructive-border`); `STYLES.refunded` / `LABELS.refunded` are unreachable — delete or widen the union.
- `apps/web/components/sidebar.tsx:172` — **UI-12.** Active nav item must be
  `bg-primary/10 text-primary [&_svg]:text-primary` (DESIGN.md §4 Navigation), not `bg-surface-3`.
- `apps/web/components/sidebar.tsx:251-300` — **UI-20.** Replace the hand-rolled dropdown with
  `DropdownMenu` from `@/components/ui/dropdown-menu` (no outside-click / Escape / `aria-expanded` today).
- `apps/web/components/sidebar.tsx:294` — **UI-14.** `text-rose-400` → `text-destructive`.
- `apps/web/components/charts/{revenue,subscriptions,mrr,failed-rate}-chart.tsx` — **UI-15.** Hardcoded
  `#94a3b8` / `#111114` / `#f3f4f6` / `rgba(148,163,184,0.2)`. Extract a shared `chartTheme` reading
  the CSS vars. Note `#111114` and `#f3f4f6` exist in no token set; use `var(--surface-2)` and
  `var(--foreground)`.
- `apps/web/components/ui/sonner.tsx:14` — **UI-21.** `useTheme()` with no `ThemeProvider` mounted.
  Pass `theme="dark"` explicitly and drop the `next-themes` import.
- `apps/web/components/settings/audit-log-section.tsx`, `apps/web/components/settings/team-quick-invite.tsx`,
  `apps/web/components/subscriptions/cancel-subscription-button.tsx` — **UI-24.** All three are dead
  (no importers). Delete.
- `apps/web/components/product-form.tsx:231,258` — **UI-23.** Two effects both fetch `/api/settings`;
  the second chain has no `.catch()` and does an unguarded `Object.values(network.tokens)`.
- `apps/web/components/product-form.tsx` + `apps/web/components/finish-setup-banner.tsx:11,18` +
  `apps/web/components/onboarding-stepper.tsx:21,23` — **UI-14 / UI-16.** Hardcoded `#06d6a0` / `#07070a`
  and `text-amber-*` → `bg-primary`, `text-primary-foreground`, `border-primary/30`, `text-warning`.
- `apps/web/components/customers/customer-detail-drawer.tsx:110` — **UI-35.** `load(id)` has no
  `cancelled` guard and no `catch`; add both to match the convention used everywhere else.
- `apps/web/components/metadata-editor.tsx:90` and
  `apps/web/components/onboarding/onboarding-wizard.tsx:305,322,355` — **UI-13.** `<Label>` with no
  `htmlFor` next to `<Input>` with no `id`. I fixed the sixteen sites that live under `app/**`; these four are yours.

## Token set now shipped by `apps/web/app/globals.css`

The dashboard now matches DESIGN.md and the docs site. Full list in my report; the notable
changes are `--background: #07070a`, `--surface-0: #0c0c10`, `--surface-1: #111116`,
`--surface-2: #18181e`, `--surface-3: #1f1f26`, `--foreground: #f0f0f3`,
`--foreground-muted: #94a3b8`, `--foreground-dim: #64748b`,
`--border: rgba(148,163,184,0.12)`, `--warning: #fbbf24`, `--info: #60a5fa`,
`--destructive: #f87171`, plus new `-muted` / `-border` tiers for every status colour and
`--sidebar: var(--surface-0)`. Components that relied on `--destructive-foreground: #fef2f2`
now get `var(--foreground)`.

---

# UTXO (Bitcoin / Litecoin) gate — what shipped, and what unblocks it

## What I gated (UI only)

The UTXO settlement path is now unreachable by default. Flag:

```
NEXT_PUBLIC_ENABLE_UTXO_PAYMENTS=true    # opt-in; unset/anything else = disabled
```

defined once in `apps/web/app/_lib/utxo-payments.ts` (`UTXO_PAYMENTS_ENABLED`,
`isUtxoNetwork()`, and the two user-facing notice strings). `_lib` is a Next.js
private folder, so it is not routable.

Gated call sites, all under `apps/web/app/**`:

- `app/checkout/[sessionId]/page.tsx` — server-side early return for a UTXO session, so the
  BIP32 receive address never reaches the browser at all.
- `app/checkout/[sessionId]/checkout-client.tsx` — UTXO render branch returns an "unavailable"
  card instead of the QR + address; the currency picker and the "Pay with" list render BTC/LTC
  options **disabled and labelled**, not hidden.
- `app/pay/[linkId]/page.tsx` — a payment link locked to BTC/LTC short-circuits *before* the
  atomic redemption increment, so an unusable link does not burn a redemption.
- `app/(dashboard)/settings/page.tsx` — UTXO network cards show an `Unavailable` badge +
  explanation; the enable Switch is disabled when off (a merchant who already enabled it can
  still turn it **off**); the xpub input is disabled.

## API half — NOT done, needs the API-routes owner

- `apps/web/app/api/settings/route.ts` — the PATCH handler still accepts `enabled: true` and an
  `overrideAddress` (xpub) for `bitcoin` / `bitcoin-testnet` / `litecoin` / `litecoin-testnet`.
  The UI gate is cosmetic without this: reject those writes (409/400) while the flag is off.
  Import `isUtxoNetwork` from `@/app/_lib/utxo-payments` or duplicate the four keys.
- `apps/web/app/api/checkout/route.ts` and `apps/web/app/api/checkout/[id]/pick-currency/route.ts`
  — should refuse to create or re-point a session onto a UTXO network while the flag is off.
  `pick-currency` is the one a determined buyer can hit directly.
- Consider moving `app/_lib/utxo-payments.ts` to `apps/web/lib/utxo-payments.ts` (the
  conventional home) once someone owns both trees; I could not write to `lib/`.

## The real fix: fiat-rate capture

Exact column names, from `packages/db/src/schema/checkout-sessions.ts:82-83`:

```
fiatRateCents:      integer("fiat_rate_cents")                          // cents per 1 WHOLE coin
fiatRateCapturedAt: timestamp("fiat_rate_captured_at", { withTimezone: true })
```

`packages/db/src/schema/payments.ts:41-42` carries the same pair, so the rate that valued a
payment is auditable on the payment row itself — the capture path must copy the session's rate
onto the payment when the indexer settles it, not re-fetch a fresh rate at confirmation time.

**Which code path must capture, and when.** The rate has to be locked at the moment the buyer is
quoted a satoshi amount — i.e. wherever a UTXO checkout session first acquires a
`networkKey`/`amount` pair. That is exactly three places:

1. `apps/web/app/api/checkout/route.ts` — session created already locked to a UTXO network.
2. `apps/web/app/api/checkout/[id]/pick-currency/route.ts` — the `awaiting_currency` →
   locked transition; this is the common path, since BTC normally appears as one option among
   several in the picker.
3. `apps/web/app/pay/[linkId]/page.tsx` — a payment link pre-locked to BTC/LTC builds its
   session values via `resolvePaymentLink` in `apps/web/lib/payment-links.ts`.

All three must write `fiat_rate_cents` **and** `fiat_rate_captured_at` in the same INSERT/UPDATE
that sets `network_key` + `amount`. If the rate lookup fails, the correct behaviour is to fail
the quote — never to write the session without a rate, which is the state that produces the
current silent-loss bug.

**Still the user's calls, deliberately not decided here:** which price source to trust, whether
the rate is per-org configurable, and the quote-expiry policy (`fiat_rate_captured_at` exists so
a stale quote can be rejected or re-quoted — someone has to pick the TTL, and it should be
shorter than the 30-minute session TTL). `btcReceiveAddress` derivation should stay downstream of
a successful capture.

**Removing the gate:** delete `app/_lib/utxo-payments.ts` and its four call sites once capture is
live. Do not simply flip the default to `true` — the flag is meant to disappear.

---

# BLOCKING: `maxFeeBps` must reach the checkout client (SC-03 intent rebind)

`apps/web/app/checkout/[sessionId]/checkout-client.tsx` now signs `maxFeeBps` (uint256) and
`flow` (uint8) in all six EIP-712 intent blocks, matching the new typehashes. `flow` is derived
client-side from the branch taken (correct — it describes the mechanism the wallet presented).
`maxFeeBps` is a value the **buyer agrees to be charged up to**, so it cannot be invented in the
browser. It is currently **not supplied by anything**, so every gasless checkout now throws
before requesting a signature:

> "This checkout is missing its platform fee ceiling, so we can't ask you to sign. Nothing was
> charged — please contact the merchant."

That refusal is deliberate — a client-side default would be a signature the buyer did not
knowingly give — but checkout stays down until one of you lands the field.

## Exact shape I need

The client reads `session.maxFeeBps`, typed `number | null | undefined`, and validates
`Number.isInteger(v) && v >= 0 && v <= 1000` (`PaymentVault.MAX_PLATFORM_FEE_BPS`). So:

- **Units:** basis points, integer. `50` = 0.5%. NOT a fraction, NOT a percentage.
- **Name on the wire:** `maxFeeBps`.
- **Where it must appear:** the `session` object handed to `<CheckoutClient session={…} />`.
  That object is built in `apps/web/app/checkout/[sessionId]/page.tsx` (mine) from a Drizzle
  `db.select({...})` over `checkout_sessions` + `products`. **I will add the one selected column
  the moment a source exists** — I cannot select a column that isn't there.
- **It must also be readable by `GET /api/checkout/[id]`**, which the client polls, so the two
  never disagree.

## What has to happen first (not mine)

1. **Pick the source.** Either
   (a) a new `checkout_sessions.max_fee_bps` integer column written at session creation —
   preferred, because it locks the ceiling at quote time exactly like `fiat_rate_cents` does and
   survives an owner fee change mid-session; or
   (b) read `platformFee()` off the deployed `PaymentVault` / `SubscriptionManager` per request.
   (b) is simpler but races: the owner can raise the fee between the read and the signature, and
   the buyer would sign the new ceiling without being shown it.
2. **Thread it through the relay.** `apps/web/app/api/checkout/[id]/relay/route.ts` — the
   `createPaymentWithPermit` / `createSubscriptionWithPermit` /
   `createSubscriptionWithPermitDiscount` arg structs need `maxFeeBps` and `flow` added in the
   contract's field order, or the digest the contract recomputes won't match what the buyer
   signed. **I deliberately did not add `maxFeeBps`/`flow` to the relay POST body** — I don't own
   your request schema and didn't want to trip a `.strict()` parse. If you want them echoed for
   an equality assertion, say so and I'll add them; otherwise the server should use its own
   authoritative value and derive `flow` from which permit fields are present.

## Field order I used (read from the contracts, not inferred)

```
PaymentIntent               packages/contracts/src/PaymentVault.sol:55
  buyer, token, merchant, amount, productId, customerId, maxFeeBps, flow, nonce, deadline

SubscriptionIntent          packages/contracts/src/SubscriptionManager.sol:37
  buyer, token, merchant, amount, interval, productId, customerId, permitValue,
  maxFeeBps, flow, nonce, deadline

SubscriptionIntentDiscount  packages/contracts/src/SubscriptionManager.sol:51
  buyer, token, merchant, amount, interval, productId, customerId, permitValue,
  discountAmount, discountCycles, maxFeeBps, flow, nonce, deadline
```

In all three, `maxFeeBps` then `flow` sit immediately **before `nonce`**. Flow values per branch:
DAI-permit → 3, Permit2 (one-time and subscription) → 2, EIP-2612 (all three intent shapes) → 1.
Note `SubscriptionManager` declares only `FLOW_EIP2612 = 1` and `FLOW_PERMIT2 = 2` — there is no
DAI subscription path.
