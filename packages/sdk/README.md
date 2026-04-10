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
  apiKey: 'pk_test_abc123',
  network: 'base-sepolia',
  merchantWallet: '0xYourWallet',
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

// Verify payment (server-side)
const payment = await paylix.verifyPayment({ paymentId: 'pay_abc' })

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
