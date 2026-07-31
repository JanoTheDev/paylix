# @paylix/sdk

TypeScript SDK for accepting crypto payments and subscriptions with
[Paylix](https://github.com/JanoTheDev/paylix) — one-time charges and
recurring billing in stablecoins, across EVM chains (Ethereum, Base,
Arbitrum, Optimism, Polygon, BNB, Avalanche and their testnets), Solana,
and UTXO chains (Bitcoin, Litecoin). Which of those a given deployment
actually accepts is up to the deployment.

Zero runtime dependencies. Node 18+, and any runtime with global `fetch`.

## Install

```bash
npm install @paylix/sdk
```

## 🔑 Keys: `sk_` is server-only

Paylix issues two kinds of key, and the difference matters:

| Prefix | Where it may go | Access |
|---|---|---|
| `sk_` **secret** | **Server only.** Never in a browser bundle, mobile app, React client component, or anything shipped to a user. | Full access to your organization: create charges, issue refunds, read every customer. |
| `pk_` **publishable** | Safe in client code. | Rate-limited, narrow. |

**This SDK requires an `sk_` key** — every method it exposes calls an
authenticated merchant endpoint. So the `Paylix` client is server-side
only. Load the key from the environment and never inline it:

```ts
const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!, // never a literal, never NEXT_PUBLIC_*
  backendUrl: 'https://pay.example.com',
})
```

If a secret key ever reaches a client, treat it as compromised: roll it in
the dashboard immediately.

The one part of this package that is safe anywhere is `webhooks.verify` —
it makes no network calls and needs no API key.

## Quick start

```ts
import { Paylix } from '@paylix/sdk'

const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  backendUrl: 'https://pay.example.com',
})

// One-time payment
const checkout = await paylix.createCheckout({
  productId: 'prod_abc',
  customerId: 'user_123',
  successUrl: 'https://myapp.com/success',
  cancelUrl: 'https://myapp.com/cancel',
})
// Redirect the buyer to checkout.checkoutUrl

// Subscription (with a free trial if the product defines one)
const sub = await paylix.createSubscription({
  productId: 'prod_pro_monthly',
  customerId: 'user_123',
})
// sub.trialEndsAt is set when the product has a trial period

// Confirm settlement server-side — don't trust the redirect
const payment = await paylix.verifyPayment({ paymentId: 'pay_abc' })
if (payment.verified) grantAccess(payment.customerId)
```

### Amounts are integer cents

`1000` means **$10.00**. This holds across the API, the database, and every
type in this package. Never pass a float.

The exception is `prices[].amount` on a product and the `amount` /
`subtotalAmount` strings on a coupon result, which are decimal strings in
the token's own units — they are typed `string` for exactly that reason.

## Configuration

```ts
new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  backendUrl: 'https://pay.example.com',

  network: 'base',   // optional; display metadata only, see below
  timeoutMs: 30_000, // optional; abort a hung request. Default 30s
  maxRetries: 2,     // optional; see "Retries". Default 2. 0 disables
  fetch: myFetch,    // optional; inject a custom fetch (proxy, agent, tests)
})
```

`network` does **not** choose the chain a payment settles on — pass
`networkKey` per call for that, or omit it and let the buyer pick on the
checkout page. It only feeds the `paylix.network` accessor, which returns
explorer and RPC metadata. It is optional so that merchants on a chain this
SDK version doesn't list can still construct a client.

## Errors

Every failure — HTTP and network alike — throws a `PaylixError`. Branch on
`type`, `status`, or `code`; the message text is not a stability contract.

```ts
import { Paylix, PaylixError } from '@paylix/sdk'

try {
  await paylix.refundPayment({ paymentId, amount: 500, txHash })
} catch (err) {
  if (err instanceof PaylixError) {
    switch (err.type) {
      case 'authentication': /* bad or revoked key */ break
      case 'permission':     /* key lacks the capability */ break
      case 'not_found':      /* no such payment */ break
      case 'invalid_request':/* err.body has the details */ break
      case 'rate_limit':     await sleep((err.retryAfterSeconds ?? 1) * 1000); break
      case 'api':            /* Paylix-side 5xx */ break
      case 'connection':     /* DNS, reset, TLS */ break
      case 'timeout':        /* exceeded timeoutMs */ break
    }
    console.error(err.status, err.code, err.requestId, err.body)
  }
  throw err
}
```

`PaylixError` carries `type`, `status`, `code`, `body` (the parsed response),
`method`, `path`, `requestId`, and `retryAfterSeconds`.

## Timeouts, retries, and idempotency

- Requests abort after `timeoutMs` (default 30s). Node's `fetch` has no
  timeout of its own, so without this a hung backend hangs your process.
- Failures retry `maxRetries` times (default 2) with jittered exponential
  backoff, honouring `Retry-After`. Retries fire on **429**, **5xx**, and
  network errors. A 429 is always replayed — the rate limiter rejects the
  request before anything changes. A 5xx or dropped socket is replayed only
  for idempotent verbs and for `POST`s carrying an idempotency key.
- Every `POST` carries an auto-generated `Idempotency-Key`, reused across
  retries, so the server collapses a replayed `createCheckout` or
  `refundPayment` into one.

Set `maxRetries: 0` to opt out entirely.

### Three methods are never retried

`extendTrial`, `compCharge`, and `rescheduleSubscription` call routes that
do not honour `Idempotency-Key`, and their effects accumulate — a replayed
`compCharge` comps a second billing period and writes a duplicate payment
row. The SDK never retries them, whatever `maxRetries` says.

If one of them throws a `connection` or `timeout` error, **the mutation may
still have been applied** — a response lost to a 504 is indistinguishable
from a request that never arrived. Read the subscription back before
re-issuing:

```ts
try {
  await paylix.compCharge(subscriptionId)
} catch (err) {
  if (err instanceof PaylixError && (err.type === 'timeout' || err.type === 'connection')) {
    const [sub] = await paylix.listSubscriptions({ customerId })
    // Only re-issue if nextChargeDate did not move.
  }
  throw err
}
```

## Webhooks

`webhooks.verify` uses a bundled HMAC-SHA256 rather than `node:crypto`, so
it runs unchanged in Node, Cloudflare Workers, Next.js edge routes, Deno,
Bun, and browsers. Import it from the root or from its own entry point when
you don't need the HTTP client:

```ts
import { webhooks } from '@paylix/sdk/webhooks'

// Pass the RAW body. Re-serializing a parsed object changes key order
// and invalidates the signature.
const valid = await webhooks.verifyAsync({
  payload: rawBody,                            // string | Uint8Array
  signature: req.headers['x-paylix-signature'],
  secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  maxAgeSeconds: 300,                          // replay window, default 5 min
})
if (!valid) return new Response('bad signature', { status: 400 })
```

**`verifyAsync` is the preferred entry point.** It computes the HMAC with
the platform's `crypto.subtle` — an audited, usually native implementation.
`webhooks.verify` takes the identical arguments and returns the identical
result synchronously, using the bundled HMAC; use it when you cannot
`await`, or on a runtime without `crypto.subtle`. Both are pinned against
the RFC 4231 vectors and cross-checked against `node:crypto`.

Neither throws on malformed input — a bad signature, a missing `sha256=`
prefix, or a stale timestamp all return `false`.

`createWebhook` returns `secret` exactly once — store it when you create
the endpoint.

## API reference

Every method below is typed and documented with JSDoc; your editor will
show the details inline.

### Checkout & subscriptions

| Method | Description |
|---|---|
| `createCheckout(params)` | Hosted checkout session for a one-time product. |
| `createSubscription(params)` | Hosted checkout session for a recurring product. |
| `cancelSubscription({ subscriptionId })` | Cancel immediately, gaslessly. |
| `scheduleSubscriptionCancellation(id)` | Cancel at the end of the paid period. |
| `resumeSubscriptionSchedule(id)` | Undo a pending period-end cancellation. |
| `updateSubscriptionWallet({ subscriptionId, newWallet })` | Change the payer wallet. |
| `giftSubscription(params)` | Grant a subscription with no payment method. |
| `listSubscriptions(params?)` | Filter by customer, status, or metadata. |

### Payments

| Method | Description |
|---|---|
| `verifyPayment({ paymentId })` | Confirm settlement. Call this from your success handler. |
| `getPayment(id)` | Alias of `verifyPayment` over the same endpoint. |
| `listPayments(params?)` | Filter by customer, status, or metadata. |
| `refundPayment(params)` | Record a refund you already broadcast on-chain. |

### Customers

| Method | Description |
|---|---|
| `createCustomer(params)` | Create a customer record. |
| `getCustomer(id)` | Customer with payments, subscriptions, invoices. |
| `updateCustomer(id, params)` | Update in place. |
| `deleteCustomer(id)` | Soft-delete; history is retained. |
| `getCustomerPortal({ customerId })` | Raw portal data. |
| `createPortalSession({ customerId })` | Signed URL to the hosted portal. |
| `listCustomerInvoices({ customerId })` | Invoices with hosted + PDF URLs. |

### Products & payment links

| Method | Description |
|---|---|
| `createProduct(params)` | Create a product and its per-network prices. |
| `updateProduct(id, params)` | Update in place. |
| `listProducts()` | Every product, with prices. |
| `createPaymentLink(params)` | Reusable hosted payment link. |
| `listPaymentLinks()` / `getPaymentLink(id)` | Read links. |
| `updatePaymentLink(id, params)` / `archivePaymentLink(id)` | Modify links. |

### Coupons & blocklist

| Method | Description |
|---|---|
| `createCoupon(params)` / `listCoupons()` / `archiveCoupon(id)` | Manage discount codes. |
| `applyCouponToCheckout(sessionId, code)` | Apply a code to an open session. |
| `removeCouponFromCheckout(sessionId)` | Restore full price. |
| `listBlocklist()` / `addBlocklistEntry(params)` / `removeBlocklistEntry(id)` | Block a wallet, email, or country. |

### Webhook management

| Method | Description |
|---|---|
| `listWebhooks()` / `createWebhook(params)` / `getWebhook(id)` | Manage endpoints. |
| `updateWebhook(id, params)` / `deleteWebhook(id)` | Modify endpoints. |
| `sendTestWebhook(webhookId, event)` | Send a synthetic event. |
| `replayWebhookDelivery(deliveryId)` | Re-send a past delivery. |
| `webhooks.verify(params)` | Verify a signature. No key required. |

### Subscription admin

| Method | Description |
|---|---|
| `extendTrial(id, days)` | Push a trial's end date out. |
| `compCharge(id)` | Comp the current period; nothing moves on-chain. |
| `rescheduleSubscription(id, nextChargeDate)` | Move the billing anchor. |

### Test helpers

| Method | Description |
|---|---|
| `testFaucet({ address, amount? })` | Mint mock USDC. Testnet deployments only. |

## Compatibility

Some routes this SDK would naturally expose do not exist yet on the server
— `GET /api/customers`, `GET /api/products/{id}`, and
`GET /api/subscriptions/{id}`. `listCustomers()`, `getProduct()`, and
`getSubscription()` were removed in 0.1.0 rather than continue to ship
methods that returned 405 for every caller. See [CHANGELOG.md](./CHANGELOG.md)
for workarounds.

## License

AGPL-3.0. See [LICENSE](./LICENSE). If you offer a modified version of
Paylix as a hosted service, you must publish your modifications.
