# Requests from the `apps/web/components/**` agent

Changes needed in files owned by other agents. Each entry is
`file:line — what must change`, grouped by the audit finding it belongs to.

---

## UI-02 — explorer links hard-pinned to Base Sepolia

I made the component half of this fix. `HashText`, `AddressText`, `col.hash`
and `col.address` now accept the network so the link resolves per-row:

- `components/paykit/explorer.ts` (new) — `networkExplorerUrl(kind, value, networkKey)`
  reads `blockExplorer` off the `NETWORKS` registry.
- `HashText` / `AddressText` take `networkKey?: string`.
- `col.hash(key, header, { networkKeyField })` / `col.address(key, header, { networkKeyField })`
  take the row field holding the chain.

When `networkKey` is absent they still fall back to `explorerUrl()` from
`@/lib/format`, i.e. today's wrong behaviour. To finish the fix:

- `apps/web/lib/format.ts:41` — `EXPLORER_BASE = "https://sepolia.basescan.org"`
  must go. Either delete `explorerUrl` entirely and make callers use
  `networkExplorerUrl`, or keep it as a 2-arg signature that reads the active
  network's `blockExplorer` via `lib/chain.ts`. **Do not change `explorerUrl`
  to require a third argument** — `HashText`/`AddressText` call it with two.
- `apps/web/app/(dashboard)/payments/*` — pass `networkKeyField: "chain"` to
  `col.hash("txHash", …)`; the `payments.chain` column holds the network key.
- `apps/web/app/(dashboard)/subscriptions/*`, `customers/*`,
  `app/portal/[customerId]/portal-client.tsx` — same, wherever a `col.hash` /
  `col.address` column is built from a row that carries a chain field.

---

## UI-22 — `LoadingState` / `ErrorState` still have (almost) no call sites

`components/paykit/feedback.tsx` now exposes both with `role="status"` /
`aria-busy` / `role="alert"`. I wired the first consumer
(`components/payments/payment-detail-drawer.tsx`). The eight duplicated
literals are all in app-owned files:

- `app/(dashboard)/api-keys/page.tsx:220` — replace the literal loading div with `<LoadingState variant="table" />`
- `app/(dashboard)/blocklist/page.tsx:190` — same
- `app/(dashboard)/checkout-links/page.tsx:164` — same
- `app/(dashboard)/coupons/page.tsx:206` — same
- `app/(dashboard)/payment-links/page.tsx:212` — same
- `app/(dashboard)/refund-requests/page.tsx:184` — same
- `app/(dashboard)/webhooks/page.tsx:361` — same
- `app/(dashboard)/audit-log/page.tsx:249` — replace the bespoke spinner too

UI-09 pairs with this: each of those loaders needs a `try/catch` + an `error`
state rendering `<ErrorState onRetry={load} />`.

---

## UI-26 — amount badges still say "USDC" at the call sites

`Amount` now takes `symbol?: string`, and `col.amount` takes
`{ symbol?, symbolKey? }`. Default is still `"USDC"`, so nothing regressed,
but the real token must be threaded in:

- `app/portal/[customerId]/portal-client.tsx:167` — the row type has `token`;
  pass `symbolKey: "token"` (or `symbol={payment.token}` if rendering `<Amount>` directly).
- `app/(dashboard)/checkout-links/page.tsx:66` — pass `symbolKey: "tokenSymbol"`
  once `SessionRow` carries it (UI-07 adds it).
- Any other `col.amount(..., { withBadge: true })` — same treatment.

---

## UI-25 — `StatusBadge` union narrowed

`STYLES.refunded` / `LABELS.refunded` were unreachable (`payment_status` in
`packages/db` is only `pending | confirmed | failed`) and are deleted. If any
app-owned file passes `status="refunded"` to `<StatusBadge kind="payment">` it
will now be a type error — render the refund state from
`payments.refundedCents` / `refundedAt` instead.

`StatusKind` is now exported from `@/components/paykit` if a caller needs it.

---

## UI-28 — overview stat cards duplicate `MetricCard`

- `app/(dashboard)/overview/overview-view.tsx:88-108` — replace the three
  hand-rolled "Trial conversion" / "30-day churn" / "Past due" divs with
  `<MetricCard label="…" value="…" />` inside a `<MetricGrid>`. Both are
  already exported from `@/components/paykit`; the hand-rolled copies drop
  `tabular-nums` and use `bg-card` instead of `bg-surface-1`.

---

## UI-29 — 756-line settings page

Not attempted: splitting it means creating `components/settings/*` **and**
rewriting `app/(dashboard)/settings/page.tsx`, which I don't own and which is
being edited concurrently.

- `app/(dashboard)/settings/page.tsx:1` — split into `PayoutWalletSection`,
  `NetworksSection`, `CheckoutDefaultsSection`, `NotificationsSection` under
  `components/settings/`, matching `business-profile-section.tsx` /
  `team-tab-content.tsx`. If you want me to author the section components,
  say so and I'll add them; the page rewrite has to be yours.
- Note `components/settings/audit-log-section.tsx` is **deleted** (UI-24 — it
  had zero importers). If the intent was to replace the inline audit table on
  that page, it needs re-authoring, not resurrecting.

---

## UI-23 — shared network-mapping logic

Extracted to `components/networks/use-merchant-networks.ts`
(`useMerchantNetworks(paymentType)` → `{ settings, networks, loading, error }`).
`ProductForm` and `OnboardingWizard` both use it now; `/api/settings` is
fetched once per form, unknown network keys are skipped with a visible
message, and fetch failures surface instead of being swallowed.

- `app/api/settings/route.ts` — no change required. Flagging only that the
  response shape the hook depends on is `{ checkoutFieldDefaults?, networks?: [{ networkKey, chainName, displayLabel, enabled }] }`.

---

## UI-27 — portal `ConfirmDialog` duplication

Left alone: `app/portal/[customerId]/portal-client.tsx` already has a
`postSubscriptionAction(url, id, fallbackMessage)` helper covering the cancel /
cancel-trial / pause dialogs, so that refactor is clearly in flight in your
file. The **resume** branch at ~`:880` still inlines its own `fetch` — fold it
into the same helper so all four normalise the error extraction
(`err.error?.message ?? err.error`), which is the actual UI-27 defect.

---

## UI-14 — raw Tailwind palette in app-owned files

Component-side occurrences are fixed. Still outstanding:

- `app/(dashboard)/audit-log/page.tsx:39-53` — `bg-emerald-500/*`, `bg-rose-500/*`,
  `bg-sky-500/*`, `bg-amber-500/*` → `success` / `destructive` / `info` / `warning` tokens
- `app/(dashboard)/settings/page.tsx` — `text-amber-600`, `text-amber-500` → `text-warning`
- `app/checkout/[sessionId]/checkout-client.tsx:1316` — `border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400` → `border-warning/30 bg-warning/10 text-warning`
- `app/(dashboard)/settings/team/new/page.tsx`, `app/onboarding/{team,profile,invite}/page.tsx` — `text-red-400` → `text-destructive`; the whole `text-slate-100/200/400` ramp → `text-foreground` / `text-foreground-muted` / `text-foreground-dim`
- `app/onboarding/layout.tsx:15` — `bg-[#07070a]` → `bg-background`
- `app/page.tsx:6` — `text-[#94a3b8]` → `text-foreground-muted`

---

## UI-13 — remaining unlabelled form controls

Fixed in `metadata-editor.tsx`, `product-form.tsx`, `onboarding-wizard.tsx`.
Still outstanding in app-owned files:

- `app/checkout/[sessionId]/checkout-client.tsx:1748, 1764, 1780, 1796, 1812, 1829` — each `<Label>` needs `htmlFor` and each `<Input>` a matching `id`
- `app/(dashboard)/checkout-links/page.tsx:204, 222, 233, 245` — same
- `app/(dashboard)/webhooks/page.tsx:439, 578` — same

---

## UI-40 — system-status polling (component half done, API half outstanding)

`components/system-status/use-system-status.ts` (new) is a module-level store
with a single 30s timer and a single in-flight guard. `SidebarContent` now
consumes it via `useSystemStatus()`, so the desktop aside and the `MobileNav`
sheet share one timer instead of running two — **6 requests/30s → 3**.

To close the finding completely:

- `app/api/system/status/route.ts` (new) — one route returning
  `{ indexer: { online }, relayer: { configured, low, balanceEth }, keeper: { … } }`.
  When it exists, only `refresh()` in `use-system-status.ts` changes (there is
  a `TODO(api)` marking the exact spot); every consumer keeps reading the same
  snapshot. That takes it to **1 request/30s**.
- `app/checkout/[sessionId]/checkout-client.tsx:176-194` — drop its private
  `/api/system/indexer-status` 30s timer and read `useSystemStatus().indexerOnline`
  instead. The hook is safe on the public checkout page: it is client-only,
  swallows fetch errors, and stops its timer when the last consumer unmounts.

---

## Tooling — remove `next-themes`

- `apps/web/package.json:40` — `next-themes` now has **zero importers
  repo-wide** (`components/ui/sonner.tsx` was its only consumer; UI-21 replaced
  `useTheme()` with an explicit `theme="dark"` default). Safe to drop from
  `dependencies`. Not editing it here — `package.json` is the tooling agent's.

---

## Note for the `globals.css` owner

`components/charts/theme.ts` resolves chart colours through
`var(--foreground-muted)`, `var(--border-subtle)`, `var(--border-strong)`,
`var(--surface-2)`, `var(--foreground)`, `var(--primary)` and
`var(--destructive)`. Recharts writes these into SVG attributes and inline
styles, so the variables must stay defined on `:root` (not only inside a
`.dark` scope) or the charts fall back to the hardcoded literals.

Each `var()` in that file carries the DESIGN.md §2 literal as its fallback
(`var(--foreground-muted, #94a3b8)` etc.) because Safari < 16.4 does not
resolve `var()` inside SVG presentation attributes. **If you change a token's
value, change the matching fallback in `charts/theme.ts` too** — they are the
only hex literals I left in `components/`, and they are deliberate.
