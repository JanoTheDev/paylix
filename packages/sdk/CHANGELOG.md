# Changelog

All notable changes to `@paylix/sdk`.

This project follows [Semantic Versioning](https://semver.org/). While the
major version is `0`, breaking changes ship in minor releases.

## 0.1.0

First release with a stable, audited public surface. **This release
contains breaking changes** — see below.

### Removed (breaking)

Three methods called endpoints that have no handler and returned HTTP 405
for every caller since they were published. Rather than keep shipping them,
they are gone until the routes exist:

- `paylix.listCustomers()` — `GET /api/customers` has no handler.
- `paylix.getProduct(id)` — `/api/products/[id]` exports only PATCH/DELETE.
- `paylix.getSubscription(id)` — `/api/subscriptions/[id]` exports only PATCH.

Workarounds until the routes ship:

| Removed | Use instead |
|---|---|
| `listCustomers()` | `getCustomer(id)` for a known customer |
| `getProduct(id)` | `listProducts()` and filter client-side |
| `getSubscription(id)` | `listSubscriptions({ customerId })` and filter |

### Changed (breaking)

- **`getPayment(id)` now returns `VerifyPaymentResult`, not `PaymentSummary`.**
  It always did at runtime — `GET /api/payments/{id}` returns the
  verification shape — so `token`, `fromAddress`, `toAddress`, `createdAt`,
  and `customer` were declared but `undefined`. Reading
  `(await paylix.getPayment(id)).customer.email` used to type-check and then
  throw. Use `listPayments()` when you need the full summary.
- **Every failure now throws `PaylixError`, not a bare `Error`.** Code that
  matched on message text may need updating; message *content* is
  preserved (the server's message is still in `err.message`) but the
  `"Paylix <operation> failed: "` prefixes are gone. Branch on
  `err.type` / `err.status` / `err.code` instead.
- **`NetworkConfig` dropped `paymentVaultAddress` and
  `subscriptionManagerAddress`.** Every entry in `NETWORKS` set both to the
  zero address — a valid-looking value that burns funds if used. The
  backend is the only authority on contract addresses.
- **`NetworkConfig.basescanUrl` renamed to `explorerUrl`**, and
  `isEvm: boolean` added. The old name was nonsense on Solana and Bitcoin.
- **`NetworkConfig.usdcAddress` is now `string | null`**, `null` on all
  testnets and non-EVM chains, where it was previously the zero address.
- **`Paylix#network` may be `undefined`.** `PaylixConfig.network` is now
  optional, so merchants on a chain this SDK version does not list can
  still construct a client.
- **`WebhookVerifyParams.payload` is typed `string | Uint8Array`** instead
  of `string | Buffer`, removing `@types/node` from the public surface. A
  Node `Buffer` is a `Uint8Array` and still passes unchanged.

### Added

- `PaylixError`, `isPaylixError`, and `PaylixErrorType` are exported. Errors
  carry `type`, `status`, `code`, `body`, `method`, `path`, `requestId`, and
  `retryAfterSeconds`.
- Request timeouts via `PaylixConfig.timeoutMs` (default 30 000 ms).
- Automatic retry with jittered exponential backoff on 429, 5xx, and
  network errors, via `PaylixConfig.maxRetries` (default 2). Honours
  `Retry-After`. 5xx and network failures are replayed only for idempotent
  verbs and for `POST`s carrying an idempotency key; 429 is always
  replayed, since the rate limiter rejects the request before the handler
  mutates anything.
- Automatic `Idempotency-Key` on every `POST`, reused across retries, so
  the server's `withIdempotency` wrapper collapses a replayed create.

  **This is only as strong as the route.** `extendTrial`, `compCharge`, and
  `rescheduleSubscription` hit routes that do **not** wrap themselves in
  `withIdempotency` and would apply their effect twice on a replay — a
  second trial extension, or a second comped billing period plus a
  duplicate payment row. Those three therefore send no key and are **never
  retried**, on any status or network fault. If one throws a `connection`
  or `timeout` error, the mutation may still have been applied: read the
  subscription back before re-issuing.
- `PaylixConfig.fetch` to inject a custom `fetch` implementation.
- `"paused"` added to `SubscriptionStatus`. The database enum and the API
  have always emitted it; an exhaustive `switch` on `sub.status` previously
  fell through for paused subscriptions, and `listSubscriptions({ status:
  "paused" })` was rejected by the SDK's own types.
- `PaylixNetwork` and `SubscriptionStatus` are now exported, along with the
  new `PaymentStatus`, `BillingInterval`, `ProductType`, and
  `InvoiceEmailStatus` unions.
- A `@paylix/sdk/webhooks` entry point for signature verification without
  the HTTP client.
- `webhooks.verifyAsync()` — same arguments and result as `verify()`, but
  computes the HMAC with the platform's `crypto.subtle` rather than the
  bundled implementation. Preferred wherever an `await` is acceptable;
  `verify()` remains for synchronous call sites and runtimes without
  `crypto.subtle`. Header parsing and the freshness window are shared, so
  the two cannot diverge on anything but the digest.
- JSDoc on every method of the `Paylix` class.

### Fixed

- **`webhooks.verify` no longer imports `node:crypto`.** HMAC-SHA256 is
  bundled, so the SDK now works in Cloudflare Workers, Next.js edge routes,
  Deno, Bun, and browser bundles. The API is unchanged and still
  synchronous.
- Every request path reports the server's error message. Roughly a dozen
  methods (coupons, blocklist, payment links, schedules) previously
  discarded the response body and surfaced only `"Bad Request"`.
- Removed the unused `viem` dependency. The SDK is a pure HTTP client and
  now has **zero runtime dependencies**; consumers no longer install a
  multi-megabyte package for nothing.
- `createPaymentLink` prefers the server-issued `url` and only falls back
  to `${backendUrl}/pay/${id}`, which is wrong when the public checkout
  host differs from the API host.
- `sideEffects: false`, `engines.node >= 18`, `publishConfig.access`, and
  `README.md` / `LICENSE` in `files` so npm renders the page, ships the
  AGPL text, and lets bundlers tree-shake unused modules.
- All path parameters are URL-encoded.

## 0.0.1

Initial internal release.
