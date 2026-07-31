# Wave 0 baseline: errors surfaced by the new lint / typecheck gates

**Date:** 2026-07-31
**Produced by:** the repo-hygiene "Wave 0" pass (REPO-01/02/03/04/05/06/07/08/09).

Before this wave, `pnpm lint` ran `eslint .` in `apps/web` and nothing else, and
no workspace ran `tsc` at all outside of `apps/web`, `apps/docs`, `packages/sdk`
(via tsup) and `packages/mailer`. Biome was configured but never installed.

`pnpm lint` now fans out to 11 workspaces and `pnpm typecheck` to 10. The errors
below are **pre-existing defects that the new gates made visible** — none were
introduced by Wave 0, and none were fixed by it.

## FINAL STATE (end of Wave 0)

Both gates are **green**, because the other agents fixed their packages' errors
as this wave surfaced them:

```
pnpm lint       →  11 successful, 11 total
pnpm typecheck  →  10 successful, 10 total
pnpm build      →   3 successful,  3 total
```

Both root scripts now pass `--continue`, so a failure in one workspace no longer
hides the remaining workspaces' results.

`packages/solana-program` has **no** `typecheck` script: its Anchor tests need
IDL types that only exist after `anchor build`, so `tsc --noEmit` can never pass
without a generated-types step. `anchor-test.yml` covers that package instead.
Do not add a bare `tsc --noEmit` there — it will fail on every PR forever.

The lists below are kept as the record of what the gates caught on first run.

## Caveat on these numbers

Several other agents were editing `apps/web/**`, `packages/*/src/**` and the
docs concurrently while this baseline was captured, so per-package counts moved
between runs (e.g. `@paylix/sdk` showed 6 typecheck errors early in the session
and 0 by the end; `@paylix/web` gained 2 new ones). Treat the counts as a
snapshot, and re-run `pnpm lint` / `pnpm typecheck` for a current list.

Commands to reproduce:

```bash
pnpm exec turbo lint --continue --force
pnpm exec turbo typecheck --continue --force
```

## `pnpm typecheck` — what it caught on first run

| Workspace | Errors | Nature | Status |
|---|---:|---|---|
| `packages/solana-program` | 10 | test files typed against `Program<Idl>` instead of generated IDL types | not fixable by `tsc`; package removed from the typecheck graph |
| **Total** | **10** | | |

Earlier in the same session the gate also caught 5 errors in `packages/config`
(`src/__tests__/networks.test.ts` — missing `signatureScheme` on a `TokenConfig`
fixture plus 4 token lookups on a union without those keys) and 2 in `apps/web`
(`components/payments/payment-detail-drawer.tsx` — `useRef` not imported). Both
were fixed by other agents while this wave was in progress; they are listed
below because they show the class of defect that was previously invisible.

Detail:

```
packages/solana-program tests/payment_vault.ts(32,3)          TS2578 Unused '@ts-expect-error' directive.
packages/solana-program tests/payment_vault.ts(108,39)        TS2339 Property 'vaultConfig' does not exist on type 'AccountNamespace<Idl>'.
packages/solana-program tests/payment_vault.ts(128,39)        TS2339 Property 'acceptedToken' does not exist on type 'AccountNamespace<Idl>'.
packages/solana-program tests/payment_vault.ts(203,37)        TS2339 Property 'vaultConfig' does not exist on type 'AccountNamespace<Idl>'.
packages/solana-program tests/payment_vault.ts(210,33)        TS2339 Property 'vaultConfig' does not exist on type 'AccountNamespace<Idl>'.
packages/solana-program tests/subscription_manager.ts(22,3)   TS2578 Unused '@ts-expect-error' directive.
packages/solana-program tests/subscription_manager.ts(74,39)  TS2339 Property 'subscriptionManagerConfig' does not exist on type 'AccountNamespace<Idl>'.
packages/solana-program tests/subscription_manager.ts(117,37) TS2339 Property 'subscription' does not exist on type 'AccountNamespace<Idl>'.
packages/solana-program tests/subscription_manager.ts(244,37) TS2339 Property 'subscription' does not exist on type 'AccountNamespace<Idl>'.
packages/solana-program tests/subscription_manager.ts(255,37) TS2339 Property 'subscription' does not exist on type 'AccountNamespace<Idl>'.
packages/config src/__tests__/networks.test.ts(66,11)         TS2741 Property 'signatureScheme' is missing ... but required in type 'TokenConfig'.
packages/config src/__tests__/networks.test.ts(241,75)        TS2339 Property 'USDT' does not exist on type ...
packages/config src/__tests__/networks.test.ts(244,23)        TS2339 Property 'USDT' does not exist on type ...
packages/config src/__tests__/networks.test.ts(255,38)        TS2339 Property 'DAI'  does not exist on type ...
packages/config src/__tests__/networks.test.ts(282,29)        TS2339 Property 'WBTC' does not exist on type ...
apps/web components/payments/payment-detail-drawer.tsx(88,21) TS2304 Cannot find name 'useRef'.
apps/web components/payments/payment-detail-drawer.tsx(89,20) TS2304 Cannot find name 'useRef'.
```

### Seen earlier in the session, fixed by other agents mid-run

Recorded because they show what the gate catches and may reappear:

```
packages/sdk    src/client.ts(119,19), (126,21)  TS2538 Type 'undefined' cannot be used as an index type.
packages/sdk    src/webhooks.ts(64,32)           TS2345 Uint8Array not assignable to Buffer.
packages/db     src/schema/unmatched-events.ts   (1 error)
packages/indexer src/__tests__/trial-converter.test.ts (6 errors)
apps/web        app/api/checkout/[id]/trial-eligibility/route.ts(74,49) TS2345 missing 'livemode'.
apps/web        lib/__tests__/integration/products-api.test.ts(177,23)  TS2554 Expected 1 arguments, but got 0.
```

## `pnpm lint` (biome lint) — what it caught on first run

4 errors, ~156 warnings. The 4 errors were fixed by the non-EVM indexer agent
during this wave; lint is now 11/11 green. Warnings do not fail the task.

| Workspace | Errors | Warnings |
|---|---:|---:|
| `packages/solana-indexer` | **2** | 34 |
| `packages/utxo-indexer` | **2** | 10 |
| `apps/web` | 0 | 91 (biome) + 8 (eslint) |
| `packages/indexer` | 0 | 5 |
| `packages/sdk` | 0 | 4 |
| `packages/mailer` | 0 | 3 |
| `packages/utxo-watcher` | 0 | 3 |
| `packages/config` | 0 | 2 |
| `packages/db` | 0 | 1 |
| `packages/solana-program` | 0 | 1 |
| `apps/docs` | 0 | 0 |
| **Total** | **4** | **~156** |

All four hard failures are the same rule, `lint/suspicious/noAssignInExpressions`,
in the two packages' test doubles:

```
packages/solana-indexer src/__tests__/db-callbacks.test.ts  (2)
packages/utxo-indexer   src/__tests__/db-callbacks.test.ts:31:4  (2)
  (selectQueues[table] ??= []).push(rows);   × The assignment should not be in an expression.
  (insertQueues[table] ??= []).push(result); × The assignment should not be in an expression.
```

### Not enforced: 372 organize-imports findings

The per-package script is `biome lint .`, not `biome check .`. `biome check`
additionally runs Biome's *assist* actions, which are pure import-ordering
rewrites — 372 of them repo-wide (apps/web 252, db 27, sdk 25, indexer 20,
solana-indexer 14, docs 11, mailer 7, utxo-watcher 7, config 5, solana-program 2,
utxo-indexer 2). `biome.jsonc` sets `"formatter": {"enabled": false}`, i.e. the
project deliberately does not enforce cosmetic style, so enforcing import order
would have made the new gate 100% red on cosmetics and hidden the 2 real errors.

If a later wave wants them, they are entirely auto-fixable:

```bash
pnpm exec biome check --write .
```

## `pnpm build`

`pnpm build` passes: **3 successful, 3 total** (`apps/web`, `apps/docs`,
`packages/sdk`).

`apps/web` was additionally verified against a clean `HEAD` checkout in an
isolated git worktree, to prove the new `output: "standalone"` works
independently of other agents' in-flight edits: the build succeeds and emits
`.next/standalone/apps/web/server.js` plus `.next/static` — exactly the paths
`apps/web/Dockerfile`'s runner stage copies and its `CMD` executes.

`packages/mailer`'s `build` was `tsc --noEmit`, which produced no output and
made turbo warn on every run; it is now covered by the new `typecheck` script
and the redundant `build` was removed.

## Consequence for `pnpm test` on Windows

`packages/contracts`' `test` script was an `echo` that exited 0 (REPO-09) and is
now `forge test`, so a green `pnpm test` means the Solidity suite actually ran.
On a machine without `forge` on `PATH` — i.e. native Windows, where this repo's
convention is to run Foundry under WSL — `pnpm test` fails at
`@paylix/contracts`. Run it from WSL, or use
`pnpm test --filter '!@paylix/contracts'`. CI installs Foundry via
`foundry-rs/foundry-toolchain`, so the full `pnpm test` works there.

Verified under WSL: `forge test` → **180 passed, 0 failed, 1 skipped** (the skip
is the mainnet-fork test, which self-skips without `FORK_RPC_URL`).

The contracts `build` script was **not** renamed to `forge build`: keeping a
`build` script would make `pnpm build` abort at `@paylix/contracts` on every
Windows machine, blocking the other three packages. It is exposed as `compile`
instead. Contracts are still compiled in CI — `forge test` compiles, and
`forge-test.yml` runs `forge build --sizes`.

## CI gates added by this wave

| Gate | Workflow | Notes |
|---|---|---|
| `pnpm build` / `lint` / `typecheck` / `test` | `web-test.yml` | no `paths` filter — every workspace is checked on every PR |
| `forge test` (deep fuzz) | `forge-test.yml` | unchanged |
| **ABI freshness** | `forge-test.yml` | new: `bash ./script/check-abi-drift.sh` recompiles `src/` and fails if the committed `abi/*.json` differ |

`packages/contracts`' `test` script is `forge test`, and `turbo test --dry-run`
confirms it is in the graph, so contracts compile on every PR via `web-test.yml`
as well as `forge-test.yml`.

Foundry is pinned to `v1.5.1` in `web-test.yml`, `forge-test.yml` and
`slither.yml` (was floating `stable`, which can change compilation output with
no diff). `v1.5.1` is the version the local suite was verified against:
180 passed, 0 failed, 1 skipped.

### Shell scripts executed by CI

This repo is authored on Windows with `core.filemode=false`, so shell scripts
are committed as mode `100644`. `./script.sh` is therefore "Permission denied"
on a Linux runner. Both the workflow step and `check-abi-drift.sh`'s internal
call invoke via `bash <script>` for that reason. A new root `.gitattributes`
pins `*.sh` to `eol=lf` so a contributor with `core.autocrlf=true` cannot commit
CRLF and produce `bad interpreter: /bin/bash^M`.

## Still open after this wave

- `apps/web/lib/wagmi.ts:24` hardcodes the live WalletConnect project ID
  `b56e18d4…` as a fallback. `.env.example` now ships a placeholder, but the
  source fallback means an operator who omits the var still routes traffic
  through that account's quota. Owned by an app-code agent (REPO-18, second half).
- `packages/contracts/script/check-abi-drift.sh` uses `git diff --exit-code`,
  which cannot see a *newly created* untracked ABI file — the same flaw as
  REPO-26. If a new contract is added, its missing ABI would pass the gate.
  `git status --porcelain` would catch both. Owned by the contracts agent.
- Branch protection: the `web-test.yml` check name changed from
  "Build · Lint · Test" to "Build · Lint · Typecheck · Test". Any existing
  required-check rule on the old name must be updated or PRs block forever.
