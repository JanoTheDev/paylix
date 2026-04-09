# PayKit

## Overview
Open-source, self-hostable crypto payment platform for developers. USDC on Base. Subscriptions + one-time payments.

## Tech Stack
- Monorepo: pnpm + Turborepo
- Dashboard: Next.js 15 (App Router), Tailwind CSS v4, shadcn/ui
- Auth: better-auth (email/password)
- Database: Drizzle ORM + PostgreSQL
- Smart Contracts: Solidity (Foundry)
- Blockchain: viem
- SDK: TypeScript, bundled with tsup
- Indexer: Node.js + viem

## Monorepo Structure
- `apps/web` — Next.js dashboard + API routes
- `apps/docs` — Documentation site (Fumadocs)
- `packages/sdk` — @paykit/sdk npm package (standalone, no monorepo deps)
- `packages/contracts` — Solidity smart contracts (Foundry)
- `packages/db` — Shared Drizzle schema + migrations
- `packages/indexer` — Blockchain event listener + keeper
- `packages/config` — Shared TypeScript configs

## Key Commands
- `pnpm dev` — start all dev servers
- `pnpm build` — build all packages
- `pnpm test` — run all tests
- `pnpm --filter @paykit/web dev` — start dashboard only
- `pnpm --filter @paykit/sdk build` — build SDK only
- `pnpm --filter @paykit/db db:generate` — generate migrations
- `pnpm --filter @paykit/db db:push` — push schema to DB
- `docker compose up -d postgres` — start PostgreSQL

## Design System
See `DESIGN.md` for the complete visual design system. Dark-first, teal accent (#06d6a0), Geist fonts, cool-tinted borders.

## Architecture Rules
- `packages/sdk` has ZERO imports from other workspace packages
- `packages/db` is shared by `apps/web` and `packages/indexer`
- All prices stored as integers in cents (1000 = $10.00 USDC)
- API keys: publishable (pk_) for client-side, secret (sk_) for server-side
- Blockchain data (amounts, hashes, addresses) always displayed in monospace font
