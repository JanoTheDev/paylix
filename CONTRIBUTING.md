# Contributing to Paylix

Thanks for your interest in contributing to Paylix! This guide takes you from
a fresh clone to an open pull request.

## Prerequisites

| Tool | Version | Needed for |
|------|---------|------------|
| Node.js | 20 (see [`.nvmrc`](.nvmrc)) | everything |
| pnpm | 9.15.4 — `corepack enable pnpm` installs the pinned version | everything |
| Docker + Docker Compose | any recent | the Postgres container |
| Foundry (`forge`, `cast`) | latest via [`foundryup`](https://getfoundry.sh) | touching `packages/contracts` |
| anchor-cli + solana-cli | anchor 0.30.1 | touching `packages/solana-program` |

On **Windows**: Foundry must run under WSL — native Windows Foundry is not
supported by this repo's scripts. And use `127.0.0.1` rather than `localhost`
in `DATABASE_URL`, because Windows resolves `localhost` to IPv6 first and
Postgres auth fails.

## Getting Started

1. Fork the repository
2. Clone your fork and create a branch:

```bash
git clone https://github.com/<your-username>/paylix.git
cd paylix
git checkout -b my-feature
```

3. Install dependencies:

```bash
pnpm install
```

4. Start the development database and services:

```bash
cp .env.example .env
# Fill in at minimum: DATABASE_URL, BETTER_AUTH_SECRET, NEXT_PUBLIC_NETWORK,
# and one ${CHAIN_KEY}_RPC_URL / _PAYMENT_VAULT / _SUBSCRIPTION_MANAGER group.
# See SELFHOST.md for the annotated list.
docker compose up -d postgres
pnpm --filter @paylix/db db:push
pnpm dev
```

`pnpm dev` runs every app and package through Turborepo. The dashboard is on
<http://localhost:3000> and the docs site on <http://localhost:3001>. To run
just one:

```bash
pnpm --filter @paylix/web dev
pnpm --filter @paylix/indexer dev
pnpm --filter @paylix/docs dev
```

Without the indexer running, payments never leave `pending` and the dashboard
shows a "Payment processing unavailable" banner — that is expected, not a bug.

## Project Structure

```text
apps/
  web/          Next.js dashboard + API + checkout
  docs/         Hand-rolled Next.js docs site (no MDX — every page is a .tsx
                component, with a build-time regex search index)
packages/
  sdk/          @paylix/sdk — TypeScript client library, zero workspace deps
  contracts/    Solidity contracts (Foundry)
  db/           Drizzle schema + migrations — shared by web AND indexer
  indexer/      EVM event listener + subscription keeper
  mailer/       Email delivery
  config/       Network registry + shared tsconfigs
  utxo-watcher/ Bitcoin + Litecoin watch-address service
  utxo-indexer/ UTXO payment writer
  solana-program/  Anchor workspace
  solana-indexer/  Solana log listener + keeper
```

Two things bite newcomers:

- **`packages/sdk` must not import from any workspace package.** It is
  published standalone to npm. Copy the type instead of adding a
  `workspace:*` dependency.
- **`packages/db` is read by both `apps/web` and `packages/indexer`.** A
  schema change has to be considered from both sides.

## Adding a docs page

The docs site is not MDX-driven. Adding a page takes three edits:

1. Create `apps/docs/app/<slug>/page.tsx`
2. Register it in the nav — `apps/docs/components/sidebar.tsx`
3. It is picked up by `apps/docs/app/sitemap.ts` and the search index
   automatically, both of which walk `app/**/page.tsx`

## Development Workflow

### Running Tests

```bash
pnpm test                                 # every TypeScript package via turbo
pnpm --filter @paylix/sdk test            # SDK
pnpm --filter @paylix/web test            # web app
pnpm --filter @paylix/indexer test        # indexer
pnpm --filter @paylix/config test         # network registry
pnpm --filter @paylix/mailer test         # mailer
pnpm --filter @paylix/utxo-watcher test   # Bitcoin / Litecoin watcher
pnpm --filter @paylix/solana-indexer test # Solana listener
```

A single file:

```bash
pnpm --filter @paylix/web test -- path/to/file.test.ts
```

`@paylix/contracts` now has a real `"test": "forge test"`, so `pnpm test`
invokes Foundry as part of the fan-out — **it fails if `forge` is not on your
`PATH`**. On Windows, where Foundry runs under WSL, run the TypeScript
packages individually and drive `forge` through WSL:

```bash
# macOS / Linux
cd packages/contracts && forge test

# Windows (Foundry lives in WSL)
wsl bash -lc "cd /mnt/c/<path>/paykit/packages/contracts && ~/.foundry/bin/forge test"
```

`@paylix/solana-program` has no `test` script — its Anchor suite is behind
`test:anchor` so it stays out of the `pnpm test` fan-out:

```bash
pnpm --filter @paylix/solana-program test:anchor
```

### Typecheck and lint

```bash
pnpm typecheck    # tsc --noEmit across every TypeScript workspace
pnpm lint         # turbo lint — eslint in apps/web
pnpm lint:fix     # biome lint --write across the repo (config: biome.jsonc)
```

### Database Changes

If you modify the Drizzle schema in `packages/db`:

```bash
pnpm --filter @paylix/db db:generate
pnpm --filter @paylix/db db:push
```

Commit the generated files under `packages/db/migrations/`. CI will fail if
generated migrations are out of sync with the schema.

## Pull Requests

1. Keep PRs focused — one feature or fix per PR
2. Add tests for new functionality
3. Make sure `pnpm test`, `pnpm typecheck` and `pnpm lint` pass locally before pushing
4. Write a clear PR description explaining what changed and why
5. Contract changes should pass `forge test --fuzz-runs 1000` and Slither with no new medium+ findings
6. If you changed anything an operator has to do, update `SELFHOST.md` in the same PR

## Commit Messages

Use clear, descriptive commit messages. We loosely follow conventional commits:

```
feat: add subscription pause/resume API
fix: handle permit front-run in PaymentVault
docs: update SDK quick start example
test: add dunning retry coverage for indexer
```

## Reporting Issues

- Use GitHub Issues for bugs and feature requests
- For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead — do not
  open a public issue

Please also read our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Paylix is licensed under [AGPL-3.0](LICENSE). Two consequences worth being
explicit about:

- By contributing, you agree your contributions are licensed under AGPL-3.0.
- The AGPL's network clause applies to this project. If you modify Paylix and
  offer the modified version to third parties as a hosted service, you must
  make your modified source available to those users. Running an unmodified
  copy, or a modified copy purely internally, carries no such obligation.
