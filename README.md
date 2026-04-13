# Paylix

> Open-source crypto payments infrastructure. Accept USDC payments and subscriptions on Base with a few lines of TypeScript.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## What is Paylix?

Paylix is a self-hostable payments stack for one-time and recurring USDC billing:

- TypeScript SDK (`@paylix/sdk`)
- Hosted checkout + dashboard (Next.js)
- On-chain settlement contracts (Foundry)
- Indexer + keeper for event sync and subscription charging

## Non-Custodial by Design

Paylix is **non-custodial** with **direct settlement**:

- Customer funds are transferred on-chain **directly from buyer wallet to merchant wallet**
- Paylix does **not** hold user balances in intermediary wallets
- The platform fee (if enabled) is split during the same on-chain payment flow
- Buyers can pay gaslessly (relayer pays gas) while USDC still settles directly to the merchant

## Quick Start (SDK)

```bash
npm install @paylix/sdk
```

```ts
import { Paylix } from "@paylix/sdk";

const paylix = new Paylix({
  apiKey: "sk_test_...",
  network: "base-sepolia",
  backendUrl: "http://localhost:3000",
});

const { checkoutUrl, checkoutId } = await paylix.createCheckout({
  productId: "prod_abc",
  customerId: "user_123",
  successUrl: "https://myapp.com/success",
  cancelUrl: "https://myapp.com/cancel",
});

// Redirect the customer to checkoutUrl
```

## Core Features

- **One-time payments** in USDC
- **Subscriptions** with keeper-driven recurring charges
- **Free trials** with trialing and trial-conversion lifecycle states
- **Gasless checkout** via relayer (no ETH required for buyers)
- **Invoices + receipts** (hosted pages and on-demand PDFs)
- **Webhooks** for payment and subscription lifecycle events
- **Customer + product APIs** in the SDK
- **Checkout links** from the dashboard
- **Testnet support** on Base Sepolia with MockUSDC
- **Self-hosting** with Docker Compose and full data ownership

## Monorepo Layout

```text
apps/
  web/          Next.js dashboard + API + checkout
  docs/         Next.js docs site
packages/
  sdk/          @paylix/sdk
  contracts/    Solidity contracts (PaymentVault, SubscriptionManager, MockUSDC)
  db/           Drizzle schema + migrations
  indexer/      Event listener + subscription keeper
  mailer/       Invoice email delivery
  config/       Shared network/tsconfig utilities
```

## Self-Hosting

1) Create environment file:

```bash
cp .env.example .env
```

2) Fill required values in `.env` (RPC, keys, contract addresses, auth secrets).

3) Start services:

```bash
docker compose up -d
```

4) Visit `http://localhost:3000` and create your account.

### What `docker compose` starts

- `web` - dashboard + API
- `indexer` - blockchain listener + keeper
- `postgres` - application database

## Local Development

```bash
pnpm install
docker compose up -d postgres
pnpm --filter @paylix/db db:push
pnpm dev
```

Useful app-specific dev commands:

```bash
pnpm --filter @paylix/web dev   # dashboard + API on :3000
pnpm --filter @paylix/docs dev  # docs site on :3001
pnpm --filter @paylix/indexer dev
```

## Testing

```bash
pnpm test
pnpm --filter @paylix/sdk test
pnpm --filter @paylix/web test
pnpm --filter @paylix/indexer test
```

Contract tests (Foundry via WSL):

```bash
wsl bash -lc "cd /mnt/c/path/to/paykit/packages/contracts && ~/.foundry/bin/forge test"
```

## License

[AGPL-3.0](LICENSE) - Free to use, self-host, and modify. If you offer a modified version as a hosted service, you must open-source your changes.
