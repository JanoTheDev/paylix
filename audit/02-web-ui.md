# Web UI & Docs Site Audit

**Scope:** `apps/web/app/**` (non-API), `apps/web/components/**`, `apps/docs/**`
**Date:** 2026-07-31

## Summary

- `apps/web/app/globals.css` and `apps/docs/app/globals.css` define **two different palettes**. The docs site implements DESIGN.md exactly (`#07070a`, `#111116`, `rgba(148,163,184,0.12)`); the dashboard ships a different neutral ramp with explicitly "no blue cast" borders. Every downstream "token-correct" class in `apps/web` therefore renders off-spec.
- Several **multi-chain regressions** in the UI layer: the block-explorer URL is hard-pinned to Base Sepolia, the checkout balance check always reads the USDC contract, and one dashboard page runs native token units through a cents formatter.
- **No error surface anywhere.** There is no `error.tsx`, `loading.tsx`, or `not-found.tsx` in `apps/web/app`, and 8 dashboard pages fetch with no `catch` and no error branch — a 500 renders as an empty table. An `ErrorState` component exists and is exported but has zero call sites.
- `checkout-client.tsx` is 2074 lines containing 4 near-duplicate EIP-712 signing branches and 5 render branches; it also carries the most severe correctness bugs found (operator-precedence on the Solana guard, premature `completed` status, raw-cents rendering).
- Accessibility gaps are systemic rather than incidental: 16 `<Label>` elements with no `htmlFor` next to `<Input>` elements with no `id`, and a sidebar dropdown with no outside-click, Escape, or `aria-expanded`.
- The docs site is **not Fumadocs** (contradicting `CLAUDE.md`); its sitemap is hand-maintained and missing 12+ existing pages, `/supported-chains` is orphaned from both nav and sitemap, and `llms.txt`/`llms-full.txt` still claim "USDC on Base" against a 10-chain registry.

## Finding Counts

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 10 |
| Medium | 23 |
| Low | 6 |

## Findings

### UI-01 — Dashboard and docs site ship two different design-token sets; neither matches DESIGN.md in `apps/web`

**Severity:** Critical
**File:** `apps/web/app/globals.css:8`
**Problem:** `apps/web/app/globals.css:8-31` defines `--background: #0a0a0c`, `--surface-1: #111113`, `--surface-2: #17171a`, `--surface-3: #1e1e22`, `--foreground: #ededef`, `--foreground-muted: #a1a1aa`, `--foreground-dim: #71717a`, `--border: rgba(255,255,255,0.06)`, `--warning: #f59e0b`, `--info: #3b82f6`, `--destructive: #ef4444`. DESIGN.md §2 mandates `#07070a` / `#111116` / `#18181e` / `#1f1f26` / `#f0f0f3` / `#94a3b8` / `#64748b` / `rgba(148,163,184,0.12)` / `#fbbf24` / `#60a5fa` / `#f87171`. `apps/docs/app/globals.css:7-41` already implements the spec values correctly, including `--surface-0`, `--border-subtle`, and the `*-muted` / `*-border` badge tiers. The inline comment at `apps/web/app/globals.css:18` ("neutral white at low opacity, no blue cast") is a deliberate contradiction of DESIGN.md's "Don't use warm-tinted grays for borders… All borders use the cool-shifted `rgba(148,163,184, …)` scale." Consequences: the dashboard and the docs site are visibly different products, and every status badge in the app renders the wrong hue.
**Fix:** Replace the `:root` block in `apps/web/app/globals.css` with the one from `apps/docs/app/globals.css` (it is already spec-conformant and has the `--surface-0`, `--border-subtle`, `--primary-hover/-active/-muted/-glow/-border`, `--success/-muted/-border` etc. tiers the components need). Then delete the shadcn alias block's `--sidebar: var(--surface-1)` in favour of `var(--surface-0)` per DESIGN.md §4 Navigation.
**Effort:** M

### UI-02 — Every explorer link is hard-pinned to Base Sepolia

**Severity:** High
**File:** `apps/web/lib/format.ts:41`
**Problem:** `const EXPLORER_BASE = "https://sepolia.basescan.org"` with `explorerUrl(kind, value)` returning `${EXPLORER_BASE}/${kind}/${value}`. This is consumed unconditionally by `apps/web/components/paykit/hash-text.tsx:20` and `apps/web/components/paykit/address-text.tsx:20`, which back `col.hash` / `col.address` in every data table (payments, subscriptions, portal, customers). The product supports Ethereum, Arbitrum, Optimism, Polygon, BNB, Avalanche, Solana, Bitcoin and Litecoin (`apps/docs/app/supported-chains/page.tsx:23-37`), so on any chain other than Base Sepolia the tx-hash link resolves to a 404 on the wrong explorer. This is the exact class of hardcode `CLAUDE.md` calls out ("Chain selection lives in `apps/web/lib/chain.ts`").
**Fix:** Make `explorerUrl` take a `networkKey` and read the explorer base from the `NETWORKS` registry in `@paylix/config/networks`; thread `networkKey` through `HashText`/`AddressText` props and the `col.hash`/`col.address` builders.
**Effort:** M

### UI-03 — Checkout insufficient-balance check reads the USDC contract regardless of the session's token

**Severity:** High
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:284`
**Problem:** `useReadContract({ address: usdcAddress, … functionName: "balanceOf" })` at lines 284-298 always queries the deployment's USDC address. The payment path immediately below resolves the real token via `(activeToken.address ?? usdcAddress)` (line 896, and again at 501, 626, 772), so a PYUSD, DAI, USDT or WETH session compares a USDC balance against `requiredTokenAmount`, which is denominated in the *active* token's decimals (line 1160-1168). For an 18-decimal token this makes `isInsufficient` (line 1170) effectively always true, which also gates the test-mode funding panel at line 1909.
**Fix:** Derive the balance token from `activeToken?.address ?? usdcAddress` in the `useReadContract` call, mirroring line 896.
**Effort:** S

### UI-04 — Operator-precedence bug makes the Solana readiness guard always pass on mainnet

**Severity:** High
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:1240`
**Problem:**
```js
const solanaReady =
  solanaConfig && solanaConfig.paymentVaultProgramId && … &&
  session.networkKey === "solana-devnet" || session.networkKey === "solana";
```
`&&` binds tighter than `||`, so the whole expression collapses to `(…everything…) || session.networkKey === "solana"`. On a `solana` mainnet session `solanaReady` is `true` even when `paymentVaultProgramId`, `subscriptionManagerProgramId`, `platformWallet` and `usdcMint` are all empty strings — and `page.tsx:152-175` defaults every one of those to `""` when the env vars are unset. The `if (solanaReady && solanaConfig)` guard on line 1248 does not save it, because `solanaConfig` is a non-null object of empty strings. `<SolanaPay programId="">` renders instead of the instructional fallback.
**Fix:** Parenthesise the network check: `… && (session.networkKey === "solana-devnet" || session.networkKey === "solana")`.
**Effort:** S

### UI-05 — Three relay branches declare the payment confirmed before the transaction lands

**Severity:** High
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:615`
**Problem:** The DAI-permit branch (line 613-616), the Permit2 subscription branch (753-756) and the Permit2 one-time branch (881-886) all do `setTxHash(...)` immediately followed by `setStatus("completed")` and `return`. `status === "completed"` renders the success card with "Payment confirmed!" / "Subscription active!" (lines 1578-1622) and starts the redirect to `successUrl`. The EIP-2612 branch does the correct thing at lines 1147-1148 — `setTxHash(...)` then `setPayStep("confirming")`, letting `useWaitForTransactionReceipt` and the polling loop drive the transition. On these three branches a reverted or dropped relay transaction still shows the buyer a confirmation.
**Fix:** Replace `setStatus("completed")` with `setPayStep("confirming")` in all three branches so they follow the same receipt-then-poll path as the EIP-2612 branch.
**Effort:** S

### UI-06 — Checkout-links product dropdown reads fields the products API does not return

**Severity:** High
**File:** `apps/web/app/(dashboard)/checkout-links/page.tsx:215`
**Problem:** The local `Product` interface (lines 34-39) declares `price: number` and `currency: string`, and line 215 renders `{p.name} — {formatAmount(p.price)} {p.currency}`. `GET /api/products` (`apps/web/app/api/products/route.ts:87-95`) spreads the `products` row and attaches a `prices: [...]` array; there is no scalar `price` or `currency` column on the products table. `formatAmount(undefined)` (`apps/web/lib/format.ts:1-9`) computes `undefined / 100` → `NaN`, so every option reads `Name — $NaN undefined`.
**Fix:** Change `Product` to `{ id; name; type; prices: { networkKey; tokenSymbol; amount: string }[] }` and render the first active price with `formatNativeAmount` from `@/lib/amounts`, matching what `checkout-client.tsx:1537-1543` does.
**Effort:** S

### UI-07 — Checkout-session amounts (native token units) are rendered through the cents formatter

**Severity:** High
**File:** `apps/web/app/(dashboard)/checkout-links/page.tsx:66`
**Problem:** `col.amount<SessionRow>("amount", "Amount", { withBadge: true })` routes through `components/paykit/amount.tsx:26` → `formatAmount(cents)` → `cents / 100`. But `checkout_sessions.amount` is `bigint("amount", { mode: "bigint" })` (`packages/db/src/schema/checkout-sessions.ts:20`) holding **native token units**, not cents — `payments.amount` is the integer-cents column (`packages/db/src/schema/payments.ts:15`). A $10.00 USDC session (10 000 000 native units) renders as `$100,000.00`. `CLAUDE.md`'s "prices are integers in cents" invariant only holds for the payments table; this column was migrated and the UI was not.
**Fix:** Add a `col.nativeAmount` builder that takes `decimals` + `tokenSymbol` and calls `formatNativeAmount`; use it for any column sourced from `checkout_sessions.amount`. Add `networkKey`/`tokenSymbol`/decimals to `SessionRow`.
**Effort:** M

### UI-08 — Portal "Restart subscription" link 404s

**Severity:** High
**File:** `apps/web/app/portal/[customerId]/portal-client.tsx:522`
**Problem:** `href={`/checkout/restart?subscriptionId=${sub.id}`}`. The only restart route is `apps/web/app/checkout/restart/[sessionId]/page.tsx`, a dynamic segment — `/checkout/restart` with no path segment does not resolve, and the route reads a *checkout session* id, not a subscription id. This is the sole recovery path shown to a customer whose `trial_conversion_failed` (rendered at lines 513-528), so the failure mode is a dead end for exactly the users who need it.
**Fix:** Either add a resolver route that maps a subscription id to its originating session id, or store the source `checkoutSessionId` on the subscription row and link `/checkout/restart/${sub.checkoutSessionId}`.
**Effort:** M

### UI-09 — Eight dashboard pages have no error state; a failed fetch is indistinguishable from empty data

**Severity:** High
**File:** `apps/web/app/(dashboard)/webhooks/page.tsx:133`
**Problem:** The load functions are all shaped `const res = await fetch(url); if (res.ok) setX(await res.json()); setLoading(false);` with no `catch` and no error state:
`webhooks/page.tsx:133-137`, `api-keys/page.tsx:80-84`, `blocklist/page.tsx:51-55`, `coupons/page.tsx:91-95`, `payment-links/page.tsx:84-92`, `refund-requests/page.tsx:60-64`, `analytics/page.tsx:38-43`, plus `checkout-links/page.tsx:87-97` (try/finally, still no error branch). A 401/500 renders the `EmptyState` ("No webhooks yet") forever; a thrown fetch (offline) rejects unhandled and leaves `loading` pinned true, so the page never leaves the skeleton. `apps/web/components/paykit/feedback.tsx:36-63` already ships an `ErrorState` with a retry button — it is exported at `components/paykit/index.ts:30` and has **zero** call sites.
**Fix:** Wrap each loader in `try/catch`, add an `error` state, and render `<ErrorState onRetry={load} />` when set. Extract the shared shape into a `useResource(url)` hook so the eight sites converge.
**Effort:** M

### UI-10 — No `error.tsx`, `loading.tsx`, or `not-found.tsx` anywhere in `apps/web/app`

**Severity:** High
**File:** `apps/web/app/(dashboard)/overview/page.tsx:34`
**Problem:** A search across `apps/web/app` for `error.tsx`, `loading.tsx`, `not-found.tsx` and `global-error.tsx` returns nothing. `overview/page.tsx:34-49` awaits a `Promise.all` of 17 DB queries plus two earlier awaits before rendering anything; with no `loading.tsx` the route shows a blank document for the full round-trip, and with no `error.tsx` any DB failure escapes to Next's default error screen (a raw digest string in production). The same applies to `checkout/[sessionId]/page.tsx`, `portal/[customerId]/page.tsx` and every `(dashboard)` route.
**Fix:** Add `app/(dashboard)/error.tsx` and `app/(dashboard)/loading.tsx` (the latter can render `<LoadingState variant="table" />`), plus `app/checkout/[sessionId]/error.tsx` and a root `app/not-found.tsx`.
**Effort:** S

### UI-11 — Applied coupon discount renders raw cents

**Severity:** High
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:1942`
**Problem:** `— {session.discountCents} off` prints the integer directly. `discountCents` is cents per the project-wide invariant, so a $5.00 coupon renders as "— 500 off" on the checkout card the buyer is about to pay from. Every other money value on this page goes through `fromNativeUnits`/`formatNativeAmount` (lines 1168, 1538).
**Fix:** Render `${(session.discountCents / 100).toFixed(2)}` inside `<MonoText>` (DESIGN.md §3: financial data is always monospace), or reuse `formatAmount` from `@/lib/format`.
**Effort:** S

### UI-12 — Active sidebar nav item is gray, not teal

**Severity:** Medium
**File:** `apps/web/components/sidebar.tsx:172`
**Problem:** The active item uses `"bg-surface-3 text-foreground"`. DESIGN.md §4 Navigation specifies "Nav item active: background `#06d6a010`, text `#06d6a0`, icon `#06d6a0`", and §7 lists active nav states as one of the four sanctioned uses of the brand accent. As written, the active item is indistinguishable from a hover state (`hover:bg-surface-2`) and the accent colour never appears in the primary chrome. `apps/docs/components/sidebar.tsx:106` and `:133` have the identical deviation.
**Fix:** Use `bg-primary/10 text-primary [&_svg]:text-primary` for the active branch in both sidebars.
**Effort:** S

### UI-13 — 16 form controls have no programmatic label

**Severity:** Medium
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:1748`
**Problem:** `components/ui/label.tsx` renders a Radix `Label.Root` (a bare `<label>`); with no `htmlFor` and no wrapped control it associates with nothing. Sixteen sites do exactly this — the entire checkout customer-details block (`checkout-client.tsx:1748, 1764, 1780, 1796, 1812, 1829`, each paired with an `<Input>` that has no `id`), `checkout-links/page.tsx:204, 222, 233, 245`, `webhooks/page.tsx:439, 578`, `metadata-editor.tsx:90`, and `onboarding/onboarding-wizard.tsx:305, 322, 355`. Screen readers announce these as unlabelled edit fields, and clicking the label does not focus the input. The correct pattern is already used elsewhere in the same files (`checkout-client.tsx:1957/1960`, `portal-client.tsx:907/909`).
**Fix:** Give each `Input`/`Select` an `id` and each `Label` the matching `htmlFor`, or migrate these blocks to the `FormField`/`FormItem`/`FormLabel` wiring already used in `components/product-form.tsx:444-456`, which handles the association automatically.
**Effort:** M

### UI-14 — Raw Tailwind palette colours instead of design tokens across 12 files

**Severity:** Medium
**File:** `apps/web/app/(dashboard)/audit-log/page.tsx:39`
**Problem:** `audit-log/page.tsx:39-53` maps audit actions to `bg-emerald-500/10 border-emerald-500/20 text-emerald-400`, `bg-rose-500/…`, `bg-sky-500/…`, `bg-amber-500/…` — a parallel status palette that bypasses `--success`/`--destructive`/`--info`/`--warning` entirely and does not match DESIGN.md's fixed status hues. The same pattern appears at `components/sidebar.tsx:294` (`text-rose-400` for Sign out instead of `text-destructive`), `app/(dashboard)/settings/page.tsx` (`text-amber-600`, `text-amber-500`), `components/product-form.tsx` (`text-amber-600`, `text-amber-500`), `app/checkout/[sessionId]/checkout-client.tsx:1316` (`border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400`), `app/(dashboard)/settings/team/new/page.tsx` and `app/onboarding/{team,profile,invite}/page.tsx` (`text-red-400`, `text-slate-100/200/400`), and `components/settings/audit-log-section.tsx`.
**Fix:** Replace with `text-success` / `text-destructive` / `text-info` / `text-warning` and `text-foreground` / `text-foreground-muted` / `text-foreground-dim`. The `text-slate-*` usages in `app/onboarding/**` are a whole second neutral ramp and should map onto the `--foreground*` tiers.
**Effort:** M

### UI-15 — Four chart components hardcode hex colours, two of which exist in no token set

**Severity:** Medium
**File:** `apps/web/components/charts/revenue-chart.tsx:37`
**Problem:** `revenue-chart.tsx:37,44,51,55,68`, `subscriptions-chart.tsx:37,43,51,55,67`, `mrr-chart.tsx:32,39,46,50,59,60` and `failed-rate-chart.tsx:40,47,54,58,70` each repeat the same literals: tick fill `#94a3b8`, axis line `rgba(148,163,184,0.2)`, tooltip background `#111114`, tooltip label `#f3f4f6`, series `#06d6a0`/`#f87171`. `#111114` and `#f3f4f6` appear in neither `globals.css` nor DESIGN.md, and `#94a3b8` is the *docs* muted colour, not the dashboard's `#a1a1aa` — so the charts already disagree with the surface they sit on. The axis/tooltip config is duplicated verbatim four times with no shared constant.
**Fix:** Export a `chartTheme` object from `components/charts/theme.ts` that reads the tokens via `getComputedStyle`/CSS vars (`var(--foreground-muted)`, `var(--surface-2)`, `var(--primary)`, `var(--destructive)`) and spread it into all four charts.
**Effort:** S

### UI-16 — Onboarding flow hardcodes brand and canvas hex values, and uses a canvas that no longer exists

**Severity:** Medium
**File:** `apps/web/app/onboarding/layout.tsx:15`
**Problem:** `bg-[#07070a]` is hardcoded on the onboarding shell while the app's `--background` is `#0a0a0c` (`globals.css:8`), so the onboarding pages are a visibly different shade than every other screen. `components/finish-setup-banner.tsx:11,18` hardcodes `border-[#06d6a0]/30 bg-[#06d6a0]/5`, `bg-[#06d6a0]`, `text-[#07070a]`, and `components/onboarding-stepper.tsx:21,23` hardcodes `bg-[#06d6a0]` / `bg-[#06d6a0]/50`. `app/page.tsx:6` hardcodes `text-[#94a3b8]`.
**Fix:** `bg-background`, `bg-primary`, `text-primary-foreground`, `border-primary/30`, `text-foreground-muted`.
**Effort:** S

### UI-17 — `checkout-client.tsx` is 2074 lines with five render branches and four signing branches in one component

**Severity:** Medium
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:1`
**Problem:** The file holds the Solana branch (1239-1361), the UTXO branch (1370-1459), the currency picker (1461-1576), the completed card (1578-1623), the expired card (1625-1640) and the main two-column EVM card (1642-2073), plus a ~770-line `handlePay` (383-1156). Every one of the high-severity findings above (UI-03, UI-04, UI-05, UI-11) lives in this file, which is the direct cost of the size — the branches drifted apart because nothing forces them to share code.
**Fix:** Extract `SolanaFallbackCard`, `UtxoPayCard`, `CurrencyPicker`, `CompletedCard`, `ExpiredCard` into sibling files, and move `handlePay`'s four schemes into `lib/checkout-signing/{eip2612,permit2,dai}.ts` returning a common `RelayPayload`.
**Effort:** L

### UI-18 — Checkout card max-width varies 480/520/720 against a 480px spec, and the footer is duplicated five times

**Severity:** Medium
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:1643`
**Problem:** DESIGN.md §4 and §5 both fix the checkout card at `max-width: 480px` ("the payment moment must feel focused, contained, and safe"). The implementation uses `max-w-[720px]` for the primary EVM card (1643), `max-w-[520px]` for the Solana fallback (1301), the UTXO card (1393) and the currency picker (1485), and `max-w-[480px]` only for the error/completed/expired cards (1377, 1581, 1627). The `"Powered by Paylix"` block is copy-pasted five times with three different type scales (`text-xs` at 1355/1453/1570/1617, `text-[11px]` at 2056).
**Fix:** Wrap all branches in one `<CheckoutCard>` shell that owns the max-width and the footer; pick a single width and record any intentional deviation from 480px in DESIGN.md.
**Effort:** M

### UI-19 — Four near-identical EIP-712 intent-signing blocks (~450 lines) in `handlePay`

**Severity:** Medium
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:555`
**Problem:** The `PaymentIntent` typed-data literal is written out verbatim four times — lines 555-585 (DAI), 825-855 (Permit2 one-time), 1059-1089 (EIP-2612 one-time) — and `SubscriptionIntent` twice more at 690-724 (Permit2) and 1022-1056 (EIP-2612), with `SubscriptionIntentDiscount` at 982-1020. Each copy re-declares the same eight/ten field descriptors, re-reads `getIntentNonce`, and re-derives `productIdBytes`/`customerIdBytes` under a different local name (`productIdBytesDai`, `productIdBytesP2`, `productIdBytes`). The relay-error handling block is likewise duplicated four times (605-612, 745-752, 873-880, 1112-1119). Any change to the intent struct must be made in 4-5 places or the contract's `_consumePaymentIntent` will reject one path.
**Fix:** Hoist `PAYMENT_INTENT_TYPES` / `SUBSCRIPTION_INTENT_TYPES` constants and a `signIntent({ kind, spender, message })` helper plus a `postRelay(body)` helper; the four branches then differ only by the permit payload.
**Effort:** M

### UI-20 — Sidebar account dropdown has no outside-click, no Escape, and no ARIA state

**Severity:** Medium
**File:** `apps/web/components/sidebar.tsx:251`
**Problem:** The trigger at 251-272 is a plain `<button>` toggling `open`, and the panel at 274-300 is a plain absolutely-positioned `<div>`. There is no `onKeyDown` Escape handler, no click-outside listener, no focus trap, and no `aria-expanded` / `aria-haspopup` / `role="menu"`. The menu stays open when the user clicks elsewhere on the page and is never announced as a menu. The codebase already depends on `radix-ui` and ships `components/ui/dropdown-menu.tsx` (257 lines) which solves all of this.
**Fix:** Replace the hand-rolled panel with `DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuContent` from `@/components/ui/dropdown-menu`.
**Effort:** S

### UI-21 — `Toaster` calls `useTheme()` with no `ThemeProvider` mounted

**Severity:** Medium
**File:** `apps/web/components/ui/sonner.tsx:14`
**Problem:** `const { theme = "system" } = useTheme()` — but `next-themes` has no provider anywhere in the tree (`app/layout.tsx:26` sets `className="dark"` statically, and grepping `app`, `components`, `lib` finds `next-themes` only in this one file). Without a provider `useTheme()` returns an empty context, so the default `"system"` always wins and sonner resolves the toast theme from `prefers-color-scheme`. On a machine set to light mode the toasts render light-on-white inside a dark-only application.
**Fix:** Pass `theme="dark"` explicitly and drop the `useTheme` import (and the `next-themes` dependency), or mount a real `ThemeProvider` and add the light-mode token block DESIGN.md §2 specifies.
**Effort:** S

### UI-22 — Seven byte-identical loading blocks while `LoadingState` sits unused

**Severity:** Medium
**File:** `apps/web/components/paykit/feedback.tsx:9`
**Problem:** `LoadingState` (feedback.tsx:9-33, with `table`/`card`/`detail` skeleton variants) and `ErrorState` (36-63) are exported from `components/paykit/index.ts:30` and imported by nothing. Meanwhile the same seven-line literal — `<div className="rounded-lg border border-border bg-surface-1 py-16 text-center text-sm text-foreground-muted">Loading…</div>` — is repeated verbatim at `api-keys/page.tsx:220`, `blocklist/page.tsx:190`, `checkout-links/page.tsx:164`, `coupons/page.tsx:206`, `payment-links/page.tsx:212`, `refund-requests/page.tsx:184`, `webhooks/page.tsx:361`, and `audit-log/page.tsx:249` diverges into a bespoke spinner.
**Fix:** Replace all eight with `<LoadingState variant="table" />`.
**Effort:** S

### UI-23 — `product-form` fetches `/api/settings` twice on mount; the second call has no error handling

**Severity:** Medium
**File:** `apps/web/components/product-form.tsx:258`
**Problem:** Two separate effects both hit `/api/settings` on mount — line 231 (checkout-field defaults) and line 258 (enabled networks) — doubling the request. The second chain has no `.catch()`, so a failed request produces an unhandled rejection, and line 267-268 does `NETWORKS[n.networkKey as keyof typeof NETWORKS]` then `Object.values(network.tokens)` with no guard: an unrecognised `networkKey` from the API throws inside the promise chain and the network selector silently stays empty forever with no user-visible signal. `components/onboarding/onboarding-wizard.tsx:73-95` performs the same lookup but does have a `.catch(() => {})` at line 92 — the two copies of this logic have already drifted.
**Fix:** Fetch `/api/settings` once and derive both pieces of state from the single response; add `if (!network) return null` before `Object.values(network.tokens)` and a `.catch` that sets an error message. Extract the shared network-mapping logic used by both `product-form` and `onboarding-wizard`.
**Effort:** S

### UI-24 — Three dead components

**Severity:** Medium
**File:** `apps/web/components/settings/audit-log-section.tsx:1`
**Problem:** `components/settings/audit-log-section.tsx` (148 lines, exports `AuditLogSection`), `components/settings/team-quick-invite.tsx` (72 lines, exports `TeamQuickInvite`) and `components/subscriptions/cancel-subscription-button.tsx` (exports `CancelSubscriptionButton`) have no importers anywhere in `app`, `components` or `lib`. `audit-log-section.tsx` also carries its own copy of the raw-Tailwind status colours flagged in UI-14, so it is dead code that still produces audit noise.
**Fix:** Delete all three. If `AuditLogSection` was meant to replace the inline audit table in `app/(dashboard)/settings/page.tsx`, wire it up instead — but do not leave both.
**Effort:** S

### UI-25 — `StatusBadge` is not a pill, mis-colours `cancelled`, and carries a dead entry

**Severity:** Medium
**File:** `apps/web/components/paykit/status-badge.tsx:88`
**Problem:** The wrapper uses `rounded-sm px-2 py-0.5 text-xs font-medium`; DESIGN.md §4 Badges specifies `border-radius: 9999px`, `padding: 3px 10px`, `11px / weight 600 / tracking 0.3px`, and §5 lists `Full 9999px` for status badges. Separately, `STYLES.cancelled` (line 47) is `bg-surface-2 text-foreground-dim ring-border` — gray — while DESIGN.md §2 and §7 both fix red (`#f87171`) as "failed/cancelled". `STYLES.refunded` (line 51) and `LABELS.refunded` (line 66) are unreachable: no member of the `StatusKind` union (lines 22-30) includes `"refunded"`.
**Fix:** Change the wrapper to `rounded-full px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.3px]`; move `cancelled` onto the destructive tokens; either add `"refunded"` to the payment status union or delete both entries.
**Effort:** S

### UI-26 — Every amount badge in every table reads "USDC" regardless of token

**Severity:** Medium
**File:** `apps/web/components/paykit/amount.tsx:33`
**Problem:** `UsdcPill` renders the literal string `USDC`. It is switched on by `col.amount(key, header, { withBadge: true })` (`components/paykit/columns.tsx:66`), used in the portal payment history (`portal-client.tsx:167`) and the checkout-links table (`checkout-links/page.tsx:66`). The rows carry a real token (`PortalPayment.token` at `portal-client.tsx:66`; `tokenSymbol` on checkout sessions), and the platform accepts USDT, DAI, PYUSD, WETH, WBTC, BTC and LTC. A DAI payment is labelled USDC in the merchant's own ledger view. `components/usdc-badge.tsx` already takes a `symbol` prop and does this correctly.
**Fix:** Add `symbol?: string` to `AmountProps` and `col.amount`'s options, defaulting to the row's token field; render `<UsdcBadge symbol={…} />` instead of the hardcoded pill.
**Effort:** S

### UI-27 — Four near-identical `ConfirmDialog` blocks in the portal (~120 lines)

**Severity:** Medium
**File:** `apps/web/app/portal/[customerId]/portal-client.tsx:769`
**Problem:** Lines 769-885 contain four `ConfirmDialog` instances (cancel, cancel-trial, pause, resume) that differ only in the target state variable, the endpoint string, and two strings of copy. Each repeats the same `onConfirm` body: null-guard, `fetch(url, { method: "POST", headers, body: JSON.stringify({ subscriptionId, customerId, token: portalToken }) })`, `if (!res.ok) throw new Error(err.error…)`, `await handleConfirmed()`. Two of them read `err.error` and two read `err.error?.message` (793 and 823 vs 852 and 881), so the same API error shape produces `[object Object]` in half the dialogs.
**Fix:** Extract `<SubscriptionActionDialog action="cancel" | "cancel-trial" | "pause" | "resume" target={…} />` driven by a config map; normalise the error extraction to one helper.
**Effort:** S

### UI-28 — Overview page hand-rolls three stat cards that duplicate `MetricCard`

**Severity:** Medium
**File:** `apps/web/app/(dashboard)/overview/overview-view.tsx:91`
**Problem:** Lines 88-108 build "Trial conversion", "30-day churn" and "Past due" as three copies of `<div className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-foreground-muted">…</p><p className="mt-1 text-2xl font-semibold font-mono text-foreground">…</p></div>` — twelve lines above, `MetricCard` is used for six other metrics on the same page. The hand-rolled version drops `tabular-nums` (which `metric-card.tsx:27` has), uses `bg-card` where `MetricCard` uses `bg-surface-1`, and uses sentence-case labels where `MetricCard` uses the uppercase tracking-wider label DESIGN.md §4 specifies for stat cards.
**Fix:** Replace all three with `<MetricCard label="…" value="…" />` inside a `MetricGrid`.
**Effort:** S

### UI-29 — 756-line settings page despite an existing `components/settings/` extraction pattern

**Severity:** Medium
**File:** `apps/web/app/(dashboard)/settings/page.tsx:1`
**Problem:** The file is a single `"use client"` component holding payout wallet, checkout-field defaults, per-network enable/override/xpub editing, notification preferences and the audit section, with ~20 `useState` hooks and five separate PATCH handlers (`saveWallet` 239-262, `saveCheckoutDefaults` 264-283, `toggleNetwork`/`setNetworkMode`/`updateOverride`/`updateXpub` 285-318, `saveMasterNotifications` 320+). A `components/settings/` directory already exists with `business-profile-section.tsx` and `team-tab-content.tsx` — the pattern is established but only half applied, and `audit-log-section.tsx` in that same directory is dead (UI-24).
**Fix:** Split into `PayoutWalletSection`, `NetworksSection`, `CheckoutDefaultsSection` and `NotificationsSection` under `components/settings/`, matching the existing two.
**Effort:** M

### UI-30 — Restart page performs a database INSERT during a GET render

**Severity:** Medium
**File:** `apps/web/app/checkout/restart/[sessionId]/page.tsx:62`
**Problem:** `RestartPage` is a server component that, on the `create_new` branch, inserts a new `checkout_sessions` row (lines 62-82) and then redirects. Page renders are not guaranteed to run once — Next.js link prefetching, a browser prefetch, or a bot crawl will each create an orphan checkout session, and a user refreshing the URL creates another. Data mutation belongs in a route handler or server action, not a render path.
**Fix:** Render a small client page with an explicit "Start a new checkout" button that POSTs to a route handler, or make the route a `POST`-only handler and link to it from a form.
**Effort:** M

### UI-31 — Docs sitemap is missing 12+ live pages and `/supported-chains` is orphaned entirely

**Severity:** Medium
**File:** `apps/docs/app/sitemap.ts:6`
**Problem:** The sitemap is a hand-maintained array of 30 URLs. Pages that exist under `apps/docs/app` but are absent from it: `/analytics`, `/api-keys`, `/blocklist`, `/branding`, `/coupons`, `/csv-export`, `/gift-subscriptions`, `/payment-links`, `/refunds`, `/scheduled-cancellation`, `/supported-chains`, `/tax`, `/sdk-reference/coupons`, `/sdk-reference/payment-links`, `/sdk-reference/blocklist`. `/supported-chains` is additionally missing from `apps/docs/components/sidebar.tsx:11-75`, so it is reachable only by typing the URL — and it is the only page documenting the 10-chain / 7-token matrix, i.e. the single most load-bearing orientation page on the site.
**Fix:** Generate the sitemap by walking `app/**/page.tsx` (the logic already exists in `scripts/build-search-index.mjs:31-49`, including the dynamic-route skip), and add `/supported-chains` to the "Operations" or a new "Chains" nav group.
**Effort:** S

### UI-32 — `llms.txt` and `llms-full.txt` are stale on version, date, and chain support

**Severity:** Medium
**File:** `apps/docs/public/llms-full.txt:2`
**Problem:** The header declares `# Version: 0.2.0` and `# Last updated: 2026-04-13`; `packages/sdk/package.json` is at `0.0.1`. Line 6 says "Accept USDC payments and subscriptions on Base", and line 25 documents `network: "base" | "base-sepolia"` as the only options — against `apps/docs/app/supported-chains/page.tsx:23-37`, which lists 7 EVM chains plus Solana, Bitcoin and Litecoin with USDC/USDT/DAI/WETH/WBTC/PYUSD. `apps/docs/public/llms.txt:2` repeats "USDC on Base" and omits 20+ pages (all of `/frameworks/*`, `/free-trials`, `/coupons`, `/refunds`, `/tax`, `/supported-chains`, `/test-mode`, `/testnet`, `/api-keys`, `/rate-limits`, `/error-codes`, `/changelog`). These are the files LLM agents read first, so the stale content propagates into generated integrations.
**Fix:** Generate both files from the same walk that builds `search-index.json` and pull the version from `packages/sdk/package.json` at build time; drop the hand-written "Last updated" line.
**Effort:** M

### UI-33 — Docs code-block copy button is invisible until hover, so it is unreachable by keyboard and touch

**Severity:** Medium
**File:** `apps/docs/components/docs/code-block.tsx:41`
**Problem:** The button wrapper is `className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"`. `opacity-0` still leaves the button in the tab order, so a keyboard user can focus an element they cannot see; on touch devices `group-hover` never fires, so the copy affordance for every code sample on the docs site is unreachable. The button itself is well-built (`copy-button.tsx:24-27` has `aria-label="Copy code"`), the wrapper defeats it.
**Fix:** Add `focus-within:opacity-100` and drop to a visible-but-dim resting state (e.g. `opacity-0 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100` plus `opacity-100` below the `md` breakpoint).
**Effort:** S

### UI-34 — Portal notification toggle reads state from a closure and uses a raw checkbox

**Severity:** Medium
**File:** `apps/web/app/portal/[customerId]/portal-client.tsx:266`
**Problem:** `toggleNotification` captures `notifState` (line 266) and calls `setNotifState(notifState.map(…))` (267-269) rather than using the functional updater. Two rapid toggles on different categories within one render cycle make the second overwrite the first, and the rollback on line 276 restores a snapshot that may already be stale. Separately, line 611-618 renders a bare `<input type="checkbox" className="mt-1 h-4 w-4">` — DESIGN.md §4 specifies a toggle switch (44×24 track, teal when active) for exactly this control, and `components/ui/switch.tsx` exists and is used in `webhooks/page.tsx:10` and `product-form.tsx:15`.
**Fix:** `setNotifState(prev => prev.map(…))` and capture `prev` in the rollback; swap the raw checkbox for `<Switch checked={n.optedIn} onCheckedChange={…} />`.
**Effort:** S

### UI-35 — Customer drawer writes state after unmount with no cancellation guard

**Severity:** Low
**File:** `apps/web/components/customers/customer-detail-drawer.tsx:110`
**Problem:** `load(id)` (lines ~105-126) awaits `fetch(/api/customers/${id})` and then calls `setData`, `setProfileDraft` and `setPaymentMetadataDraft` with no `cancelled` flag, while the effect at 128-136 re-invokes it on every `customerId` change. Closing the drawer or switching customers mid-flight lets the stale response overwrite the newer one. Every other async effect in this codebase uses the `let cancelled = false` pattern (`checkout-client.tsx:177`, `:307`; `product-form.tsx:230`, `:257`; `sidebar.tsx:68`; `onboarding-wizard.tsx:74`) — this one is the outlier. The loader also has no `catch`, so a network failure rejects unhandled.
**Fix:** Add the `cancelled` guard and an `AbortController`, matching the surrounding convention; add a `catch` that sets `profileError`.
**Effort:** S

### UI-36 — Leftover `console.error` in production checkout paths

**Severity:** Low
**File:** `apps/web/app/checkout/[sessionId]/checkout-client.tsx:1150`
**Problem:** `console.error("Payment failed:", err)` in the `handlePay` catch, and `console.error("[solana-pay] error:", err)` at `app/checkout/[sessionId]/solana-pay.tsx:177`. Both run on the public, unauthenticated checkout page and dump raw error objects (which include wallet addresses and RPC payloads) to the buyer's console.
**Fix:** Remove both; the user-facing `setPayError(msg.slice(0, 200))` on the next line already handles the surface. If telemetry is wanted, route it through a real reporter.
**Effort:** S

### UI-37 — Root `/` is a dead-end placeholder with no navigation

**Severity:** Low
**File:** `apps/web/app/page.tsx:1`
**Problem:** The whole page is a centred `<h1>Paylix</h1>` plus a tagline in a hardcoded `text-[#94a3b8]` (see UI-16). There is no link to `/login`, `/register` or `/overview`, and no redirect. A signed-in user who clicks a bare domain link lands on a page with no way forward.
**Fix:** Either `redirect()` to `/overview` when a session exists and `/login` otherwise, or render a minimal landing with both links.
**Effort:** S

### UI-38 — Emoji glyphs used as status icons on the checkout error states

**Severity:** Low
**File:** `apps/web/app/checkout/[sessionId]/page.tsx:76`
**Problem:** `CheckoutStateCard` takes an `icon: string` rendered at `text-4xl` (line 25) and is called with `"✘"` (76), `"✓"` (88) and `"⏳"` (103); `app/checkout/restart/[sessionId]/page.tsx:14` repeats `"✘"`. DESIGN.md §7 explicitly says "Don't use emoji or decorative icons — use Lucide icons at 16-18px, stroke width 1.5px". `⏳` is an emoji and will render as a colour glyph. The same component in `checkout-client.tsx:1584` and `:1629` correctly uses Lucide `CheckCircle2` and `Clock` for the identical states — the server and client halves of the same flow use different icon systems.
**Fix:** Change `icon` to `ReactNode` and pass `<XCircle size={40} strokeWidth={1.5} />`, `<CheckCircle2 …>`, `<Clock …>` matching the client component.
**Effort:** S

### UI-39 — `CLAUDE.md` describes the docs site as Fumadocs; it is a hand-rolled Next.js app

**Severity:** Low
**File:** `apps/docs/package.json:12`
**Problem:** `apps/docs/package.json` lists `next`, `react`, `shiki`, `lucide-react`, `clsx`, `tailwind-merge` and two Radix packages — no `fumadocs-*` dependency of any kind. Every page is a hand-written `.tsx` React component (34 route directories under `apps/docs/app`) composed from `components/docs/{callout,code-block,doc-table,page-heading,param-row,section-heading}`, with a bespoke regex search indexer (`scripts/build-search-index.mjs`) and a bespoke TOC (`components/toc.tsx`). `CLAUDE.md`'s repository-layout and commands sections both call it "the Fumadocs site", which will send contributors looking for `.mdx` files and `meta.json` that do not exist.
**Fix:** Correct the description in `CLAUDE.md` to "hand-rolled Next.js docs site with a build-time regex search index", and note that adding a page means creating `app/<slug>/page.tsx` **and** registering it in `components/sidebar.tsx` and `app/sitemap.ts` (see UI-31).
**Effort:** S

### UI-40 — Sidebar polls three separate status endpoints every 30 seconds on every dashboard page

**Severity:** Low
**File:** `apps/web/components/sidebar.tsx:124`
**Problem:** `SidebarContent` fires `/api/system/indexer-status`, `/api/system/relayer-status` and `/api/system/keeper-status` on mount and then all three every 30s (lines 121-128). `SidebarContent` is mounted twice on mobile-capable viewports — once by `Sidebar` (line 308) and once by `MobileNav` → `Sheet` (`components/mobile-nav.tsx:30`) — and `checkout-client.tsx:176-194` independently polls `/api/system/indexer-status` on its own 30s timer. That is 6 background requests per minute per open dashboard tab for three booleans and two balance strings.
**Fix:** Collapse the three into one `/api/system/status` endpoint returning all three blocks, and hoist the poll into a shared context/hook so the desktop and mobile sidebars share a single timer.
**Effort:** S

## Quick Wins

- **UI-04** — one pair of parentheses fixes the Solana readiness guard.
- **UI-03** — one-line change to the `useReadContract` address.
- **UI-05** — swap `setStatus("completed")` for `setPayStep("confirming")` in three places.
- **UI-11** — divide by 100 and wrap in `MonoText`.
- **UI-22** — replace eight duplicated loading divs with the already-written `LoadingState`.
- **UI-24** — delete three unreferenced components.
- **UI-25** — `rounded-sm` → `rounded-full` and move `cancelled` onto destructive tokens.
- **UI-33** — add `focus-within:opacity-100` to the docs copy-button wrapper.
- **UI-36** — delete two `console.error` calls.
- **UI-20** — swap the hand-rolled menu for the existing `DropdownMenu` primitive.
