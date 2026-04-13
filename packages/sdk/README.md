# @paylix/sdk

TypeScript SDK for accepting crypto payments via Paylix. One-time and recurring USDC payments on Base.

## Install

```bash
npm install @paylix/sdk
```

## Quick Start

```ts
import { Paylix } from '@paylix/sdk'

const paylix = new Paylix({
  apiKey: 'sk_test_...',
  network: 'base-sepolia',
  backendUrl: 'http://localhost:3000',
})

// One-time payment
const checkout = await paylix.createCheckout({
  productId: 'prod_abc',
  customerId: 'user_123',
  successUrl: 'https://myapp.com/success',
  cancelUrl: 'https://myapp.com/cancel',
})
// Redirect user to checkout.checkoutUrl

// Subscription
const sub = await paylix.createSubscription({
  productId: 'prod_pro_monthly',
  customerId: 'user_123',
  successUrl: 'https://myapp.com/welcome',
  cancelUrl: 'https://myapp.com/pricing',
})

// Subscription with free trial
const trial = await paylix.createSubscription({
  productId: 'prod_pro_monthly', // product with trialDays: 14
  customerId: 'user_123',
  successUrl: 'https://myapp.com/welcome',
  cancelUrl: 'https://myapp.com/pricing',
})
// trial.trialEndsAt is set when the product has a trial period
// trial.checkoutUrl → hosted checkout shows "Start free trial" CTA

// Verify payment (server-side)
const payment = await paylix.verifyPayment({ paymentId: 'pay_abc' })

// List payments — filter by customer, status, or metadata
const payments = await paylix.listPayments({
  customerId: 'cust_xyz',
  metadata: { userId: 'user_123' },
})
// Each result includes customer info:
// payments[0].customer.email, payments[0].customer.walletAddress

// List subscriptions with the same filters
const subs = await paylix.listSubscriptions({ status: 'active' })

// Manage webhooks programmatically
const hook = await paylix.createWebhook({
  url: 'https://myapp.com/webhooks',
  events: ['payment.confirmed', 'subscription.created'],
})

// Verify webhook (server-side)
import { webhooks } from '@paylix/sdk'
const valid = webhooks.verify({
  payload: requestBody,
  signature: headers['x-paylix-signature'],
  secret: 'whsec_...',
})
```

## License

AGPL-3.0
