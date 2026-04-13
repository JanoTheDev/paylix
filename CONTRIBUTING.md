# Contributing to Paylix

Thanks for your interest in contributing to Paylix! This guide will help you get started.

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
# Fill in required values
docker compose up -d postgres
pnpm --filter @paylix/db db:push
pnpm dev
```

## Project Structure

```text
apps/
  web/          Next.js dashboard + API + checkout
  docs/         Documentation site
packages/
  sdk/          @paylix/sdk — TypeScript client library
  contracts/    Solidity contracts (Foundry)
  db/           Drizzle schema + migrations
  indexer/      Blockchain event listener + subscription keeper
  mailer/       Email delivery
  config/       Shared TypeScript and network configuration
```

## Development Workflow

### Running Tests

```bash
pnpm test                          # all packages
pnpm --filter @paylix/sdk test     # SDK only
pnpm --filter @paylix/web test     # web app only
pnpm --filter @paylix/indexer test # indexer only
```

Contract tests require Foundry (via WSL on Windows):

```bash
cd packages/contracts
forge test
```

### Linting

```bash
pnpm lint
```

### Database Changes

If you modify the Drizzle schema in `packages/db`:

```bash
pnpm --filter @paylix/db db:generate
pnpm --filter @paylix/db db:push
```

CI will fail if generated migrations are out of sync with the schema.

## Pull Requests

1. Keep PRs focused — one feature or fix per PR
2. Add tests for new functionality
3. Make sure `pnpm test` and `pnpm lint` pass locally before pushing
4. Write a clear PR description explaining what changed and why
5. Contract changes should pass `forge test --fuzz-runs 1000` and Slither with no new medium+ findings

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
- For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.
