# Paylix Codebase Audit

**Date:** 2026-07-31
**Commit:** `392e5ed`
**Method:** Six independent reviewers, one per subsystem. Every finding cites `path:line` and was verified by reading the code. Vendored `packages/contracts/lib/**` (forge-std, OpenZeppelin) was excluded.

## Reports

| # | Report | Scope | Findings |
|---|---|---|---|
| 01 | [Web API & Server Lib](01-web-api.md) | `apps/web/app/api/**`, `apps/web/lib/**`, `middleware.ts` | 38 |
| 02 | [Web UI & Docs Site](02-web-ui.md) | `apps/web/app/**` (non-API), `apps/web/components/**`, `apps/docs/**` | 40 |
| 03 | [Indexers, Keepers & Mailer](03-indexers.md) | `packages/{indexer,solana-indexer,utxo-indexer,utxo-watcher,mailer}` | 44 |
| 04 | [Smart Contracts](04-contracts.md) | `packages/contracts/{src,test,script,abi}` | 28 |
| 05 | [SDK, DB Schema & Config](05-sdk-db.md) | `packages/{sdk,db,config,solana-program}` | 36 |
| 06 | [Repo Hygiene & OSS Readiness](06-repo-hygiene.md) | root config, `.github/**`, per-package manifests, CI, scripts | 41 |

**Total: 227 findings — 14 Critical, 58 High, 110 Medium, 45 Low.**

| Severity | Count | Meaning |
|---|---|---|
| Critical | 14 | Loses money, loses payments, or exposes keys. Fix before any mainnet use. |
| High | 58 | Wrong behaviour under normal conditions, or a security gap needing an unusual precondition. |
| Medium | 110 | Correctness edge cases, duplication, missing validation, maintainability debt. |
| Low | 45 | Polish, consistency, docs, minor gas. |

## Critical findings

Fix these first. Each links to the full write-up in its report.

### Money and payment loss

| ID | Report | Problem |
|---|---|---|
| IDX-01 | [03](03-indexers.md) | Solana and UTXO indexers write a text customer identifier into a `uuid` FK column. The insert always fails, the error is swallowed, and the session is still marked completed — the payment vanishes. |
| IDX-04 | [03](03-indexers.md) | UTXO payments store satoshis in the cents column. 100,000 sats displays as $1,000.00. |
| IDX-05 | [03](03-indexers.md) | The cursor advances past `getLogs` chunks that failed and past logs whose handler threw. Confirmed payments are lost with no trace. |
| IDX-03 | [03](03-indexers.md) | The Solana listener has no cursor, no backfill, and no restart recovery. Any downtime loses those events permanently. |
| IDX-06 | [03](03-indexers.md) | The unmatched-event retry deletes the retained row before replaying it, so a failed replay drops the event — this is the exact invariant `recordUnmatched` exists to uphold. |
| DB-01 | [05](05-sdk-db.md) | The migration chain never renames `user_id`/`merchant_id` to `organization_id`. Running `db:migrate` on a fresh database produces a schema the application cannot query. |

### Security

| ID | Report | Problem |
|---|---|---|
| SC-01 | [04](04-contracts.md) | `addSubscriptionBackupPayer` attaches a backup wallet without that wallet's consent, and the permit failure is swallowed by a `try/catch`. Any address with a standing allowance — including cancelled subscribers — is drainable to an attacker-controlled merchant. |
| API-02 | [01](01-web-api.md) | The portal-token HMAC falls back to a hardcoded secret committed in the repo. |
| API-03 | [01](01-web-api.md) | Refund verification decodes any 3-topic log as a `Transfer` without checking `topics[0]`, so a USDC `Approval` event passes as proof of refund. |
| API-04 | [01](01-web-api.md) | `PATCH`/`POST /api/checkout/[id]` is unauthenticated and can rewrite the session amount and customer PII. |
| REPO-01 | [06](06-repo-hygiene.md) | No `.dockerignore`, so `COPY . .` bakes the operator's `.env` — including mainnet private keys — into the published image. |

### Correctness

| ID | Report | Problem |
|---|---|---|
| API-01 | [01](01-web-api.md) | Checkout sessions are created without `livemode`, so `sk_live_` keys transact against testnet. |
| IDX-02 | [03](03-indexers.md) | A block-tag RPC failure is caught and falls back to the bare latest head, breaking the documented "indexer never reads the unsafe head" invariant — reorged payments get marked confirmed. |
| UI-01 | [02](02-web-ui.md) | The dashboard and the docs site ship two different design-token sets, and neither matches `DESIGN.md`. |

## Themes

Recurring patterns behind the individual findings:

1. **Swallowed errors mark work as done.** `catch {}` blocks around database writes, RPC calls, and transaction receipts consistently let the happy path continue. This is the root cause of IDX-01, IDX-02, IDX-05, IDX-07, IDX-08 and SC-01.
2. **Multi-chain support was added by copy-paste.** The Solana and UTXO indexers duplicate the EVM listener's structure but not its safeguards (cursors, confirmations, unmatched-event retention). Several UI paths still hardcode Base Sepolia or assume USDC.
3. **Nothing enforces the invariants.** Five workspaces never typecheck in CI, Biome is configured but not installed, and the contracts `test` script is an `echo`. The documented rules exist only in `CLAUDE.md`.
4. **The published surface has drifted from the implementation.** Three SDK methods call routes that have no handler, `getPayment()`'s declared type does not match what the endpoint returns, and the exported ABIs are three releases behind `src/`.
5. **Self-hosting is not reproducible.** `deploy.sh` is referenced in five documents but is not in the repo, and the web Dockerfile cannot build as written.

## Suggested order of work

1. **Stop the bleeding** — the six payment-loss Criticals plus `REPO-01`. Nothing else matters if payments disappear or operator keys ship in the image.
2. **Close the security Criticals** — `SC-01` needs a contract change and a redeploy, so start it early; `API-02`, `API-03`, `API-04` are same-day fixes.
3. **Make CI able to catch regressions** — `REPO-04` (typecheck every workspace), `REPO-05` (actually install and run Biome), real `forge test` in CI. Do this before the High-severity cleanup so the cleanup is verified.
4. **High severity, by subsystem** — each report orders its findings most-severe-first and ends with a Quick Wins list.
5. **Medium and Low** — treat the Quick Wins lists as good first issues for outside contributors.
