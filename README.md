# Paylix

> Open-source crypto payment infrastructure for developers. Accept USDC payments and subscriptions with a few lines of TypeScript.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## What is Paylix?

Paylix lets developers accept one-time and recurring crypto payments without writing Solidity or managing wallets. Smart contracts are fully abstracted behind a clean TypeScript SDK. Self-host the entire platform for free.

## Quick Start

```bash
npm install @paylix/sdk
```

```ts
import { Paylix } from '@paylix/sdk'

const paylix = new Paylix({
  apiKey: 'pk_test_abc123',
  network: 'base-sepolia',
  merchantWallet: '0xYourWallet',
  backendUrl: 'http://localhost:3000',
})

const { checkoutUrl } = await paylix.createCheckout({
  productId: 'prod_abc',
  customerId: 'user_123',
  successUrl: 'https://myapp.com/success',
  cancelUrl: 'https://myapp.com/cancel',
})
// Redirect your user to checkoutUrl
```

## Features

- **One-time payments** — Accept USDC with a single SDK call
- **Subscriptions** — Recurring billing with automatic charges
- **Dashboard** — Manage products, view payments, track subscribers
- **Checkout links** — Generate shareable payment links from the dashboard
- **API keys** — Publishable + secret keys for SDK authentication
- **Webhooks** — Real-time notifications for payment events
- **Customer management** — Collect emails, track purchase history
- **Testnet support** — Full testing on Base Sepolia with mock USDC
- **Self-hostable** — Deploy with Docker Compose, own your data
- **0.5% fee** — On officially deployed contracts (0% if self-hosted)

## Self-Hosting

```bash
git clone https://github.com/JanoTheDev/paylix.git
cd paylix
cp .env.example .env
# Edit .env with your values
docker compose up -d
```

Visit `http://localhost:3000` to create your account and start accepting payments.

## Architecture

```
apps/
  web/          — Next.js dashboard + API + checkout page
  docs/         — Documentation site
packages/
  sdk/          — @paylix/sdk (npm package)
  contracts/    — Solidity smart contracts (Foundry)
  db/           — Shared Drizzle schema
  indexer/      — Blockchain event listener + keeper
```

## Tech Stack

- **SDK**: TypeScript + viem
- **Dashboard**: Next.js 15, Tailwind CSS v4, better-auth, Drizzle ORM
- **Contracts**: Solidity (Foundry), deployed on Base
- **Database**: PostgreSQL
- **Monorepo**: pnpm + Turborepo

## Development

```bash
pnpm install
docker compose up -d postgres
pnpm --filter @paylix/db db:push
pnpm dev
```

## Testing

```bash
pnpm test                          # run all tests
pnpm --filter @paylix/sdk test     # SDK tests only
pnpm --filter @paylix/web test     # API tests only
```

Smart contract tests (requires Foundry via WSL):
```bash
wsl bash -lc "cd /mnt/c/path/to/paykit/packages/contracts && ~/.foundry/bin/forge test"
```

## License

[AGPL-3.0](LICENSE) — Free to use, self-host, and modify. If you offer a modified version as a hosted service, you must open-source your changes.
