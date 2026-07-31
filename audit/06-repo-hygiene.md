# Repo Hygiene & Open-Source Readiness Audit

**Scope:** root config, `.github/**`, per-package `package.json`/`tsconfig.json`, docs, CI, scripts, dependency hygiene
**Date:** 2026-07-31

## Summary

- No committed secrets were found in the tracked tree. A pattern sweep across all 1456 tracked files (excluding `packages/contracts/lib/` and `pnpm-lock.yaml`) for private keys, `sk_live_`/`sk_test_`, Alchemy/Infura tokens, AWS keys, PEM blocks, GitHub/Slack tokens returned only placeholder values in `.env.example`. `gitleaks.yml` is wired correctly.
- The documented Docker self-hosting path is non-functional. `apps/web/Dockerfile` cannot build (missing `output: "standalone"`, malformed `COPY` line), both Dockerfiles omit a workspace package their `pnpm install --frozen-lockfile` needs, and there is no `.dockerignore` — so a successful build would bake the operator's `.env` (mainnet deployer/relayer private keys, by the project's own design) into an image layer.
- CI has real coverage gaps: five workspaces (`db`, `indexer`, `utxo-watcher`, `utxo-indexer`, `solana-indexer`) have no `build` or `typecheck` script, so their TypeScript is never compiled by any job; `packages/mailer`, `packages/utxo-*` and `packages/solana-indexer` are absent from every workflow's path filter, so a PR touching only those runs zero checks.
- Lint is largely theatre: `biome.jsonc` configures a linter that is not a dependency of any workspace and is not invoked by any script or workflow; `turbo lint` resolves to a single `eslint .` in `apps/web`.
- Docs point at files that do not exist. `./deploy.sh` — the entry point for contract deployment in README, SELFHOST and `.env.example` — is not in the repository, and README/SELFHOST link to `CLAUDE.md` and `docs/superpowers/specs/` which are now gitignored (deletion staged at time of audit).
- Missing OSS table stakes: no `CODE_OF_CONDUCT.md`, no issue templates, no PR template, no `CODEOWNERS`, no `CHANGELOG`, no `.gitattributes`, no release/publish workflow for the npm-published `@paylix/sdk`, and no `engines` field in any of the 12 workspace manifests.

## Finding Counts

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 8 |
| Medium | 21 |
| Low | 11 |

## Findings

### REPO-01 — No `.dockerignore`: `COPY . .` bakes the operator's `.env` (mainnet private keys) into the image

**Severity:** Critical
**File:** `apps/web/Dockerfile:18` (and repo root — no `.dockerignore` exists)
**Problem:** `git ls-files | grep -i dockerignore` returns nothing; there is no `.dockerignore` at the repo root or beside either Dockerfile. `apps/web/Dockerfile:18` is `COPY . .`, which copies the entire build context — including the root `.env` that `docker-compose.yml:8` simultaneously declares as `env_file`, plus the four `.env.bak.*` files currently sitting in the working directory — into the `builder` layer. Per `.env.example:234-241` that file is expected to hold `MAINNET_DEPLOYER_PRIVATE_KEY`, `MAINNET_RELAYER_PRIVATE_KEY` and `MAINNET_KEEPER_PRIVATE_KEY`. Even though the final `runner` stage only copies `.next/standalone`, the secret persists in the intermediate layer and in any image pushed with `--target builder`, cached layer export, or registry mirror. `node_modules/` and `.git/` are copied too, making builds slow and non-reproducible.
**Fix:** Add a root `.dockerignore` containing at minimum `node_modules`, `.git`, `.env`, `.env.*`, `!.env.example`, `**/.next`, `**/dist`, `.turbo`, `graphify-out`, `packages/contracts/out`, `packages/contracts/cache`. Replace `COPY . .` with explicit `COPY apps/web ./apps/web`, `COPY packages/db ./packages/db`, etc. so the context is opt-in rather than opt-out.
**Effort:** S

---

### REPO-02 — `apps/web` Docker image cannot build: no `output: "standalone"`, and `COPY` line contains shell operators

**Severity:** High
**File:** `apps/web/Dockerfile:26`, `apps/web/Dockerfile:28`, `apps/web/next.config.ts:3`
**Problem:** Two independent hard failures. (1) `Dockerfile:26` copies `/app/apps/web/.next/standalone`, but `apps/web/next.config.ts` sets only `transpilePackages` and `webpack` — there is no `output: "standalone"`, so Next never emits `.next/standalone` and the `COPY` fails with "not found". (2) `Dockerfile:28` is `COPY --from=builder /app/apps/web/public ./apps/web/public 2>/dev/null || true`. `COPY` is not run through a shell; Docker parses this as five arguments, treating `true` as the destination and `2>/dev/null` and `||` as source paths that do not exist. Both README (`README.md:159`) and SELFHOST (`SELFHOST.md:161-167`) present `docker compose up -d` as the primary self-hosting path, so the headline install method is broken.
**Fix:** Add `output: "standalone"` to `apps/web/next.config.ts`. Replace line 28 with an unconditional `COPY --from=builder /app/apps/web/public ./apps/web/public` (the directory exists) or drop it. Add a CI job that runs `docker compose build` so this cannot regress.
**Effort:** S

---

### REPO-03 — Both Dockerfiles omit `packages/mailer`, so `pnpm install --frozen-lockfile` fails at the deps stage

**Severity:** High
**File:** `apps/web/Dockerfile:6-10`, `packages/indexer/Dockerfile:5-9`
**Problem:** `apps/web/package.json` declares `"@paylix/mailer": "workspace:*"` and `packages/indexer/package.json` declares the same. Neither Dockerfile copies `packages/mailer/package.json` before running `pnpm install --frozen-lockfile`. pnpm resolves the workspace link from `pnpm-workspace.yaml` + the copied manifests; with `packages/mailer` absent the `workspace:*` specifier is unsatisfiable and the frozen-lockfile install errors out. The web image additionally never copies `packages/mailer` source, so even a successful install would fail at `next build`.
**Fix:** Add `COPY packages/mailer/package.json ./packages/mailer/` to both deps stages, and copy the mailer source in the builder stage. Better: switch to `pnpm deploy --filter` or `turbo prune --docker`, which generate the correct pruned lockfile automatically instead of hand-maintaining the manifest list.
**Effort:** M

---

### REPO-04 — Five workspaces are never typechecked by anything

**Severity:** High
**File:** `turbo.json:3-25`, `packages/db/package.json:11-16`, `packages/indexer/package.json:7-11`
**Problem:** `turbo.json` defines `build`, `dev`, `lint`, `test`, `db:generate`, `db:migrate` — there is no `typecheck` task. Of the twelve workspaces, only `apps/web`, `apps/docs`, `packages/sdk` (via `tsup`) and `packages/mailer` (via `build: tsc --noEmit`) compile TypeScript. `packages/db`, `packages/indexer`, `packages/utxo-watcher`, `packages/utxo-indexer` and `packages/solana-indexer` have no `build` and no `typecheck` script, so `turbo build` skips them entirely. Their only CI exercise is `vitest`, which uses esbuild and strips types without checking them. Type errors in the Drizzle schema or the indexer's event handlers — the two components CLAUDE.md calls out as the highest-risk shared surface — ship undetected.
**Fix:** Add `"typecheck": "tsc --noEmit"` to every TS workspace, add a `typecheck` task to `turbo.json` (`{"dependsOn": ["^build"]}`), add `"typecheck": "turbo typecheck"` to the root `package.json`, and add a `pnpm typecheck` step to `web-test.yml` between Build and Lint.
**Effort:** M

---

### REPO-05 — Biome is configured but not installed and never executed; `pnpm lint` covers one workspace

**Severity:** High
**File:** `biome.jsonc:1-26`, `package.json:17`, `turbo.json:12-14`
**Problem:** `biome.jsonc` pins `https://biomejs.dev/schemas/2.5.3/schema.json` and defines a curated include/exclude set, but `grep -rn "biome" --include=package.json` across the workspace returns zero hits — `@biomejs/biome` is not a dependency of any package, appears in no `scripts` block, and is invoked by no workflow. Meanwhile `turbo lint` fans out to workspaces with a `lint` script, and only `apps/web` has one (`eslint .`). So `pnpm lint` — the command CONTRIBUTING.md:68 tells contributors to run before pushing — lints `apps/web` only. `packages/sdk`, `packages/indexer`, `packages/db`, `packages/mailer`, `packages/config`, `apps/docs`, and the utxo/solana packages are unlinted despite the four most recent commits being biome lint fixes across exactly those trees.
**Fix:** Add `@biomejs/biome@2.5.3` as a root devDependency, add `"lint": "biome check ."` (or `biome ci .`) to the root `package.json`, and either add per-package `lint` scripts or drop `turbo lint` in favour of a single root biome invocation plus the `apps/web` eslint run. Ensure `web-test.yml` runs both.
**Effort:** M

---

### REPO-06 — CI path filters exclude four workspaces, so PRs touching them run no checks at all

**Severity:** High
**File:** `.github/workflows/web-test.yml:12-33`
**Problem:** The only TypeScript workflow triggers on `apps/**`, `packages/sdk/**`, `packages/db/**`, `packages/indexer/**`, `packages/config/**`, plus root config files. `packages/mailer/**`, `packages/utxo-watcher/**`, `packages/utxo-indexer/**` and `packages/solana-indexer/**` are missing. Those four contain 14 tracked test files (4 mailer, 3 utxo-watcher, 7 solana-indexer) and — for mailer — the invoice-delivery code path that `apps/web` and `packages/indexer` both import. A PR that only changes `packages/mailer/src/drivers/smtp.ts` triggers no workflow whatsoever: not web-test, not forge-test, not drizzle-check. It merges with zero automated verification.
**Fix:** Replace the enumerated path list with `packages/**` (excluding `packages/contracts/**` and `packages/solana-program/**` if you want to keep them on their dedicated workflows), or simply drop the `paths` filter from `web-test.yml` — the job is cheap relative to the risk.
**Effort:** S

---

### REPO-07 — `deploy.sh`, the documented deployment entry point, does not exist in the repository

**Severity:** High
**File:** `README.md:24`, `README.md:156`, `README.md:166-172`, `SELFHOST.md:88-108`, `.env.example:87`
**Problem:** README, SELFHOST and `.env.example` all instruct the operator to run `./deploy.sh <chain> <network>`, and SELFHOST.md:110-116 documents six specific behaviours of that script (compiles, runs the test suite, deploys, exports ABIs, writes addresses back into `.env`). `git ls-files | grep -i deploy` shows no `deploy.sh` and no `deploy/` directory anywhere in the tree. SELFHOST.md:92 says `cp -r deploy.sh deploy/ ../` — copying a file that isn't there — and SELFHOST.md:36 references `deploy/lib/wsl.sh`, also absent. README.md:155 rationalises this as "deploy.sh lives outside the repo — copy it up one level first" without ever saying where a fresh clone obtains it. A self-hoster following the documented steps cannot deploy contracts.
**Fix:** Either commit `deploy.sh` + `deploy/` into the repo (they are operator tooling, not secrets — they read secrets from `.env`, which is gitignored), or replace every reference with the concrete `forge script script/DeployTestnet.s.sol --rpc-url ... --broadcast` invocations they wrap. The current state is unshippable for an OSS project.
**Effort:** M

---

### REPO-08 — `turbo.json` declares no `env`/`globalDependencies`, so `.env` changes do not invalidate the build cache

**Severity:** High
**File:** `turbo.json:4-7`
**Problem:** The `build` task lists `dependsOn` and `outputs` but no `env`, `passThroughEnv`, or top-level `globalDependencies`. `apps/web/package.json:8` builds via `dotenv -e ../../.env -- next build`, and `NEXT_PUBLIC_NETWORK` (`.env.example:72`) is inlined into the client bundle at build time — the file's own comment says "this var sets the checkout bundle's network at build time". Because `.env` is not in the cache key, flipping `NEXT_PUBLIC_NETWORK=base-sepolia` to `base` and re-running `pnpm build` restores the cached testnet bundle. For a payments product this means shipping a checkout page pointed at the wrong chain and wrong contract addresses with no visible error.
**Fix:** Add `"globalDependencies": [".env", ".env.example"]` and a `"globalEnv"`/per-task `"env"` list covering `NEXT_PUBLIC_*`, `DATABASE_URL`, `*_PAYMENT_VAULT`, `*_SUBSCRIPTION_MANAGER`, `*_RPC_URL` to `turbo.json`. Turbo will then hash them into the cache key.
**Effort:** S

---

### REPO-09 — `packages/contracts` and `packages/solana-program` report success without running any tests

**Severity:** High
**File:** `packages/contracts/package.json:9-13`, `packages/solana-program/package.json:5-7`
**Problem:** `packages/contracts` defines `"test": "echo 'Run via WSL: ...'"` and `"build": "echo ..."` — both exit 0 without compiling or testing anything. `packages/solana-program` defines `"test": "echo '...' && exit 0"`. `turbo test` therefore reports these packages green. README.md:190 advertises `pnpm test` as running "all packages (527+ tests)", which a reader will reasonably take to include the 123 non-fork Solidity tests in `packages/contracts/test/`. Those only run in `forge-test.yml`, which is gated behind a `packages/contracts/**` path filter — so a change in `apps/web` that breaks an ABI assumption is never checked against the contracts.
**Fix:** Make the stub scripts fail loudly (`exit 1` with the instruction) rather than exit 0, so a green `pnpm test` means something. Correct README.md:190 to state that `pnpm test` covers TypeScript only and that contracts require `forge test`. Consider a `test:contracts` root script that shells out to forge when available.
**Effort:** S

---

### REPO-10 — `@paylix/config` is a runtime dependency of `apps/web` but declared as a devDependency

**Severity:** Medium
**File:** `apps/web/package.json:60`
**Problem:** `@paylix/config` sits in `devDependencies`, yet 28 files under `apps/web` import it at runtime — `app/api/checkout/[id]/relay/route.ts:24`, `app/checkout/[sessionId]/checkout-client.tsx:13`, `app/api/system/relayer-status/route.ts:4`, and 25 more import `@paylix/config/networks` or `@paylix/config/deployments`. Any production install path that prunes dev dependencies (`pnpm install --prod`, `pnpm deploy`, a multi-stage Docker runner) drops the package and the app fails at import. Relatedly, `apps/web/next.config.ts:3` lists only `@paylix/db` in `transpilePackages` even though `@paylix/config` and `@paylix/mailer` also ship raw `.ts` via their `exports` maps.
**Fix:** Move `"@paylix/config": "workspace:*"` into `apps/web`'s `dependencies`. Add `@paylix/config` and `@paylix/mailer` to `transpilePackages`.
**Effort:** S

---

### REPO-11 — AI planning artifacts under `docs/superpowers/` are tracked in `HEAD`

**Severity:** Medium
**File:** `docs/superpowers/specs/2026-04-23-bitcoin-integration.md` (and 5 sibling files)
**Problem:** `git status` shows six staged deletions under `docs/superpowers/plans/` and `docs/superpowers/specs/`, with a matching `.gitignore:28` rule (`docs/superpowers/`) added in the same uncommitted change. Until that lands they remain in `HEAD` and in git history. These are AI-generated planning documents, not project documentation, and README.md:232-235 / SELFHOST.md:262 link to them as if they were the design-spec archive.
**Fix:** Commit the staged deletion and the `.gitignore` change. Then fix the dangling links (see REPO-12). If the specs have lasting value, promote the durable content into a curated `docs/` tree that is intended to be public.
**Effort:** S

---

### REPO-12 — README and SELFHOST link to files that are gitignored or never existed

**Severity:** Medium
**File:** `README.md:231-235`, `SELFHOST.md:261-262`
**Problem:** Four kinds of broken link. (a) `README.md:231` and `SELFHOST.md:261` link to `CLAUDE.md`, which `.gitignore:21-22` (`CLAUDE.md`, `**/CLAUDE.md`) excludes — a fresh clone has no such file. (b) `README.md:232` and `SELFHOST.md:262` link to the `docs/superpowers/specs/` directory, now gitignored per REPO-11. (c) `README.md:233` links to `docs/superpowers/specs/2026-04-11-multi-chain-multi-token-design.md`, which is not present in the tracked tree even before the deletion — only four spec files were ever tracked. (d) README.md:231 describes CLAUDE.md as the architecture reference, meaning the project has no public architecture document at all.
**Fix:** Delete the four dead links. Move the architecture/invariants content that currently lives only in the gitignored `CLAUDE.md` into a tracked `ARCHITECTURE.md` and link that instead.
**Effort:** M

---

### REPO-13 — 781 vendored third-party contract files are committed; workflows assume submodules that do not exist

**Severity:** Medium
**File:** `packages/contracts/lib/` (781 tracked files), `.github/workflows/forge-test.yml:34`, `.github/workflows/slither.yml:38`
**Problem:** `git ls-files packages/contracts/lib | wc -l` returns 781 — the full source of `forge-std@1.15.0` and `openzeppelin-contracts@5.1.0`, including OpenZeppelin's own `package.json`, `.eslintrc`, hardhat config and 16 shell scripts, all checked directly into the repo. There is no `.gitmodules` (`cat .gitmodules` → not found), so `packages/contracts/.gitignore` (which ignores `out/`, `cache/`, `broadcast/` but not `lib/`) lets them through. Both `forge-test.yml:34` and `slither.yml:38` pass `submodules: recursive` to `actions/checkout`, which is a silent no-op. The vendored OZ manifest also confuses Dependabot's `/packages/contracts` npm target. Consequence: dependency updates are invisible to tooling, and reviewers cannot tell a vendored-library change from a first-party one in a diff.
**Fix:** Convert `lib/forge-std` and `lib/openzeppelin-contracts` to real git submodules (`forge install`), add `packages/contracts/lib/` to `.gitignore`, and keep `submodules: recursive` in the workflows. If vendoring is deliberate, document why in `packages/contracts/README.md` and drop `submodules: recursive` from both workflows so the intent is legible.
**Effort:** M

---

### REPO-14 — Missing OSS community files: no code of conduct, issue templates, PR template, or CODEOWNERS

**Severity:** Medium
**File:** `.github/` (contains only `dependabot.yml` and `workflows/`)
**Problem:** `git ls-files .github` returns exactly seven files: `dependabot.yml` and six workflows. There is no `CODE_OF_CONDUCT.md`, no `.github/ISSUE_TEMPLATE/`, no `PULL_REQUEST_TEMPLATE.md`, no `CODEOWNERS`, no `FUNDING.yml`. CONTRIBUTING.md:103 tells reporters to "Use GitHub Issues for bugs and feature requests" with no structure to guide them, and CONTRIBUTING.md:82-89 lists PR expectations that are never surfaced in the PR body. For a payments project taking outside contributions, `CODEOWNERS` on `packages/contracts/src/**` and `apps/web/app/api/checkout/**` is the cheapest safeguard available.
**Fix:** Add `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml` + `config.yml` (with `blank_issues_enabled: false` and a link to SECURITY.md), `.github/PULL_REQUEST_TEMPLATE.md` mirroring the CONTRIBUTING checklist, and `.github/CODEOWNERS` requiring review on contracts, relay routes, and `packages/db/src/schema/`.
**Effort:** S

---

### REPO-15 — `@paylix/sdk` is published to npm with no release workflow, no CHANGELOG, and no LICENSE file

**Severity:** Medium
**File:** `packages/sdk/package.json:1-56`, `.github/workflows/`
**Problem:** README.md:58 tells users `npm install @paylix/sdk`, and the package is `version: 0.0.1` with `license: AGPL-3.0`. There is no publish workflow in `.github/workflows/`, no `CHANGELOG.md` anywhere in the repo, no `prepublishOnly` guard, and no `publishConfig` (so no npm provenance attestation). `git ls-files packages/sdk` shows `README.md` but no `LICENSE`; npm auto-includes a `LICENSE` file if one exists beside the manifest, and none does — so the published tarball carries an AGPL-3.0 `license` field with no license text, which is exactly what AGPL §4 requires you to distribute. There is also no `engines` field telling consumers the supported Node range.
**Fix:** Copy the root `LICENSE` to `packages/sdk/LICENSE`. Add `"publishConfig": {"access": "public", "provenance": true}` and `"engines": {"node": ">=20"}`. Add a `release.yml` workflow triggered on `v*` tags that runs build + test then `pnpm publish --access public`. Start a `CHANGELOG.md` (Changesets fits a Turborepo well).
**Effort:** M

---

### REPO-16 — `foundry.toml` RPC aliases reference env vars that `.env.example` never defines

**Severity:** Medium
**File:** `packages/contracts/foundry.toml:14-16`
**Problem:** `[rpc_endpoints]` declares `base_sepolia = "${RPC_URL}"` and `base = "${BASE_MAINNET_RPC_URL}"`. Neither `RPC_URL` nor `BASE_MAINNET_RPC_URL` appears anywhere in `.env.example`, which uses `BASE_SEPOLIA_RPC_URL` (line 100) and `BASE_RPC_URL` (line 108). Any contributor running `forge script --rpc-url base_sepolia` after filling in `.env.example` gets an empty URL. The alias set is also stale relative to the seven chains README.md:26-34 claims support for — only Base is represented.
**Fix:** Rename the interpolations to `${BASE_SEPOLIA_RPC_URL}` and `${BASE_RPC_URL}`, and add the remaining twelve chain aliases so `--rpc-url <chain>` works uniformly.
**Effort:** S

---

### REPO-17 — Five of six workflows declare no `permissions`, inheriting the repository default token scope

**Severity:** Medium
**File:** `.github/workflows/web-test.yml:39`, `forge-test.yml:23`, `anchor-test.yml:28`, `drizzle-check.yml:32`, `gitleaks.yml:23`
**Problem:** Only `slither.yml:30-32` sets an explicit `permissions` block. The other five omit it entirely, so `GITHUB_TOKEN` gets whatever the repository/organisation default is — historically `write-all` on repos created before the default changed. These jobs run `pnpm install` and `cargo test`, both of which execute arbitrary third-party lifecycle scripts; a compromised transitive dependency would inherit a write-scoped token. None of the five needs anything beyond `contents: read`.
**Fix:** Add `permissions: {contents: read}` at the top level of each of the five workflows (`gitleaks.yml` additionally needs `pull-requests: write` only if PR commenting is kept — see REPO-27).
**Effort:** S

---

### REPO-18 — `.env.example` ships a real WalletConnect project ID, hardcoded again as a fallback in app source

**Severity:** Medium
**File:** `.env.example:77`, `apps/web/lib/wagmi.ts:24`
**Problem:** `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set to a concrete 32-hex project ID rather than a placeholder, and the same literal is hardcoded in `apps/web/lib/wagmi.ts:24` as a fallback with the comment "public fallback for localhost testing". This is a live credential belonging to a specific Reown/WalletConnect account: every self-hoster who does not override it routes their relay traffic through that account, consuming its quota and exposing its usage analytics. The `.env.example` comment (lines 74-76) acknowledges this but the fallback in source means the variable can be silently omitted.
**Fix:** Replace the value in `.env.example` with `YOUR_WALLETCONNECT_PROJECT_ID` (matching the `YOUR_ALCHEMY_KEY` convention on line 100). Remove the hardcoded fallback in `wagmi.ts` and fail fast with a clear message pointing at https://dashboard.reown.com.
**Effort:** S

---

### REPO-19 — pnpm version is contradictory across `packageManager`, docs, and the lockfile story

**Severity:** Medium
**File:** `package.json:26`, `SELFHOST.md:17`
**Problem:** `package.json:26` pins `"packageManager": "pnpm@9.15.4"`, and `pnpm-lock.yaml:1` is `lockfileVersion: '9.0'`. `SELFHOST.md:17` tells operators to install **pnpm 10+**. A contributor who follows SELFHOST installs pnpm 10, which writes a v9.0 lockfile differently and — with corepack active — will refuse to run at all against the `packageManager` pin. CI sidesteps this because `pnpm/action-setup` honours `packageManager`, so the mismatch only bites humans.
**Fix:** Pick one. Either bump `packageManager` to `pnpm@10.x` and regenerate the lockfile, or change `SELFHOST.md:17` to "pnpm 9.15.4 (installed automatically via corepack)". Also add `"engines": {"node": ">=20", "pnpm": ">=9"}` to the root manifest.
**Effort:** S

---

### REPO-20 — No `engines` field in any of the twelve workspace manifests

**Severity:** Medium
**File:** `package.json:22-26` (and all 11 workspace manifests)
**Problem:** `.nvmrc` says `20`, both Dockerfiles use `node:20-alpine`, CI pins `node-version: 20`, and `SELFHOST.md:17` says "Node.js 20+". None of that is enforced: no `package.json` in the repo declares `engines`. A contributor on Node 18 gets confusing failures (Next 15 requires ≥18.18, `vitest@4` requires ≥20.19) instead of a clear install-time error, and `@paylix/sdk` publishes without an engine range for downstream consumers.
**Fix:** Add `"engines": {"node": ">=20.19", "pnpm": ">=9.15"}` to the root `package.json` and `"engines": {"node": ">=20"}` to `packages/sdk/package.json`. Optionally add `engine-strict=true` in an `.npmrc`.
**Effort:** S

---

### REPO-21 — tsconfig drift: three packages bypass the shared base config

**Severity:** Medium
**File:** `apps/docs/tsconfig.json:1-40`, `packages/mailer/tsconfig.json:1-14`, `packages/solana-program/tsconfig.json:1-11`
**Problem:** Nine workspaces extend `@paylix/config/tsconfig.{base,node,nextjs}.json`. Three do not, and each has drifted. `apps/docs` targets `ES2017` while the shared `tsconfig.nextjs.json:3` targets `ES2020`, and it omits `forceConsistentCasingInFileNames` and `moduleDetection: "force"` — the casing flag matters because this project is developed on Windows and built on Linux CI, where a wrong-case import passes locally and fails in CI. `packages/mailer` duplicates seven compiler options by hand and likewise omits `forceConsistentCasingInFileNames`. `packages/solana-program` is a standalone config with no shared inheritance.
**Fix:** Make `apps/docs/tsconfig.json` extend `@paylix/config/tsconfig.nextjs.json` and `packages/mailer/tsconfig.json` extend `@paylix/config/tsconfig.node.json` (adding only `jsx: react-jsx` and `noEmit`), adding `@paylix/config` as a devDependency to each. Leave `solana-program` alone or give it a `tsconfig.mocha.json` in the config package.
**Effort:** S

---

### REPO-22 — Shared strictness baseline is weak: no `noUncheckedIndexedAccess`, `noImplicitOverride`, or `noFallthroughCasesInSwitch`

**Severity:** Medium
**File:** `packages/config/tsconfig.base.json:3-14`
**Problem:** The base config enables `strict: true` and little else on the safety axis. `noUncheckedIndexedAccess` is absent, which matters directly for this codebase: array and record indexing on event logs, `NETWORKS[key]` lookups, and `splits[0]` style access all type as non-`undefined` today. `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature` and `verbatimModuleSyntax` are also unset. For a codebase where a wrong index silently yields `undefined` and then a runtime `TypeError` inside a payment handler, this is the cheapest available class of bug prevention.
**Fix:** Add `"noUncheckedIndexedAccess": true`, `"noImplicitOverride": true`, `"noFallthroughCasesInSwitch": true` to `packages/config/tsconfig.base.json`. Expect a batch of fixes; land it alongside REPO-04 so the new errors are actually surfaced by CI.
**Effort:** L

---

### REPO-23 — `turbo.json` build outputs include `.next/cache/**`

**Severity:** Medium
**File:** `turbo.json:6`
**Problem:** `"outputs": [".next/**", "dist/**", "out/**"]` captures `.next/cache/`, Next's internal webpack/SWC cache. Turbo will archive tens to hundreds of MB per build into the local (and any remote) cache, and restoring a stale `.next/cache` alongside a restored `.next/` can produce inconsistent incremental state. Turbo's own Next.js recipe excludes it.
**Fix:** Change to `"outputs": [".next/**", "!.next/cache/**", "dist/**", "out/**"]`.
**Effort:** S

---

### REPO-24 — Generated `search-index.json` is committed and regenerated on every dev/build run

**Severity:** Medium
**File:** `apps/docs/public/search-index.json`, `apps/docs/package.json:8-11`, `apps/docs/scripts/build-search-index.mjs:125`
**Problem:** `apps/docs/package.json` defines `predev` and `prebuild` hooks that run `scripts/build-search-index.mjs`, which writes to `../public/search-index.json` (`build-search-index.mjs:17,125`). That 44 KB file is tracked in git. Every `pnpm dev` and `pnpm build` therefore dirties the working tree, producing spurious diffs in unrelated PRs and a merge conflict on any docs PR touched by two contributors. It also means the committed copy can silently disagree with the docs pages it indexes.
**Fix:** Add `apps/docs/public/search-index.json` to `.gitignore` and `git rm --cached` it. The `prebuild` hook already guarantees it exists before `next build`, including in CI and Docker.
**Effort:** S

---

### REPO-25 — No root `.gitattributes`: shell scripts can be checked out with CRLF and fail under WSL

**Severity:** Medium
**File:** repo root (no `.gitattributes`), `packages/contracts/export-abi.sh`
**Problem:** `git ls-files | grep -i gitattributes` returns only two files inside the vendored `packages/contracts/lib/`. There is no repository-level `.gitattributes`. This project is explicitly developed on Windows (CLAUDE.md's Windows section, `SELFHOST.md:35-37`) and executes its shell scripts under WSL/bash. A contributor with `core.autocrlf=true` — the Git-for-Windows default — checks out `export-abi.sh` with CRLF endings; bash then fails with `bad interpreter: /bin/bash^M`. The same applies to `.sol`, `.sql` migration files, and the `pnpm-lock.yaml` diff noise.
**Fix:** Add a root `.gitattributes` with `* text=auto eol=lf`, `*.sh text eol=lf`, `*.sol text eol=lf`, `pnpm-lock.yaml -diff linguist-generated=true`, and `packages/contracts/lib/** linguist-vendored=true`.
**Effort:** S

---

### REPO-26 — Drizzle drift check uses `git diff`, which cannot see newly created migration files

**Severity:** Medium
**File:** `.github/workflows/drizzle-check.yml:62`
**Problem:** The guard runs `git diff --exit-code --quiet packages/db/migrations`. `git diff` compares the working tree against the index for *tracked* files only; a migration that `drizzle-kit generate` creates fresh (`0042_foo.sql`, `meta/0042_snapshot.json`) is untracked and invisible to it. The check currently works by accident because `meta/_journal.json` is tracked and gets rewritten — but any drizzle-kit change to journal handling, or a schema edit that produces only new snapshot files, silently passes a job whose entire purpose is to fail.
**Fix:** Replace with `if [ -n "$(git status --porcelain packages/db/migrations)" ]; then ... exit 1; fi`, which catches modified *and* untracked paths. Keep the existing `git diff` output for the error message.
**Effort:** S

---

### REPO-27 — Dependabot covers 8 of 12 workspaces and no Rust or Docker ecosystems

**Severity:** Medium
**File:** `.github/dependabot.yml:8-15`, `.github/dependabot.yml:34-36`
**Problem:** The npm `directories` list names `/`, `/apps/web`, `/apps/docs`, `/packages/sdk`, `/packages/db`, `/packages/indexer`, `/packages/config`, `/packages/contracts`. Missing: `/packages/mailer`, `/packages/utxo-watcher`, `/packages/utxo-indexer`, `/packages/solana-indexer`, `/packages/solana-program`. `packages/utxo-watcher` is the one that matters most — it depends on `bitcoinjs-lib`, `tiny-secp256k1`, `bip32`, `bip39` and `ws`, i.e. the key-derivation and network surface of the Bitcoin integration, and gets no advisory-driven bumps. `/packages/contracts` is listed but its own manifest has zero dependencies (it resolves the vendored OZ manifest instead — see REPO-13). There is also no `cargo` ecosystem entry for `packages/solana-program` (three `Cargo.toml` files) and no `docker` entry for the two Dockerfiles pinned to `node:20-alpine` / `postgres:16-alpine`.
**Fix:** Add the five missing npm directories, drop `/packages/contracts`, and add `package-ecosystem: cargo` (directory `/packages/solana-program`) and `package-ecosystem: docker` (directories `/apps/web`, `/packages/indexer`) blocks.
**Effort:** S

---

### REPO-28 — SECURITY.md offers a single unverifiable email with no GitHub-native fallback

**Severity:** Medium
**File:** `SECURITY.md:9`
**Problem:** The only disclosure channel is `security@paylix.dev`. There is no PGP key for encrypting a report about an exploitable fund-drain path, no GitHub Private Vulnerability Reporting fallback, and no `.github/SECURITY.md` symlink so the "Report a vulnerability" button appears in the right place (GitHub reads root `SECURITY.md`, so this part is fine). `SECURITY.md:16` and `:37` both promise a 48-hour acknowledgement, which a single-maintainer project (the repo is `JanoTheDev/paylix`) will struggle to honour. `.env.example:31` lists "You have a bug bounty published before taking real traffic" as a pre-mainnet checklist item and `SELFHOST.md:224` names Immunefi, but SECURITY.md itself mentions no bounty, safe-harbour clause, or reward scale — the three things that actually attract researchers to a payments protocol.
**Fix:** Enable GitHub Private Vulnerability Reporting and reference it as the preferred channel. Publish a PGP key fingerprint. Add an explicit safe-harbour paragraph. Soften the 48h SLA to something sustainable, or back it with a monitored alias.
**Effort:** S

---

### REPO-29 — `@types/node` is pinned to v25 while every runtime target is Node 20

**Severity:** Medium
**File:** `apps/web/package.json:62`, `packages/indexer/package.json:23`, `packages/mailer/package.json:20`, `packages/sdk/package.json:49`
**Problem:** Four packages pin `"@types/node": "25.5.2"` — exact, no caret, inconsistent with every other range in the repo. `@types/node@25` describes the Node 25 API surface, but `.nvmrc` is `20`, both Dockerfiles use `node:20-alpine`, and CI sets `node-version: 20`. Code can typecheck against APIs that do not exist at runtime (Node 22/23/24/25 additions to `node:fs`, `node:util`, `node:test`, the `stream` and `crypto` webcrypto surface). Three other packages use `"@types/node": "^20"`, so the monorepo has two incompatible views of the Node API in the same install.
**Fix:** Standardise on `"@types/node": "^20"` (or `^22` with a matching `.nvmrc`/Dockerfile/CI bump) across all seven packages that declare it. Use a caret, and add a `pnpm.overrides` entry in `pnpm-workspace.yaml` to keep transitive copies aligned.
**Effort:** S

---

### REPO-30 — README self-hosting quickstart contradicts itself and omits prerequisites

**Severity:** Medium
**File:** `README.md:148-162`, `README.md:178-185`
**Problem:** The quickstart runs `docker compose up -d` (line 159) — which per `docker-compose.yml:2-20` starts `web`, `indexer` and `postgres` — and then immediately tells the reader to also run `pnpm --filter @paylix/web dev` (line 160) and `pnpm --filter @paylix/indexer dev` (line 161). The dev server binds :3000, which the `web` container already published (`docker-compose.yml:6-7`), so the second command fails with EADDRINUSE, and two indexer instances would race on the same events. The block also never runs `db:push`/`db:migrate`, so the database has no schema — the "Local development" block on lines 180-185 does, but the self-hosting block doesn't. Finally there is no Prerequisites section anywhere in README (Node 20, pnpm, Docker, Foundry); it only exists in `SELFHOST.md:14-37`.
**Fix:** Make the README quickstart the Docker path only (`cp .env.example .env`, `docker compose up -d`, migrate, open :3000) and link to SELFHOST for the pnpm-dev path. Add a short Prerequisites section above it.
**Effort:** S

---

### REPO-31 — `export-abi.sh` uses `set -e` only and hardcodes a personal Foundry install path

**Severity:** Low
**File:** `packages/contracts/export-abi.sh:2`, `packages/contracts/export-abi.sh:10`
**Problem:** Line 2 is `set -e` without `-u` or `-o pipefail`; an unset variable expands to empty and a failure mid-pipeline is swallowed. Line 10 invokes `~/.foundry/bin/forge` by absolute-ish path rather than `forge` from `PATH` — that is the WSL layout on the original author's machine. A contributor who installed Foundry via a package manager, into `/usr/local/bin`, or on macOS gets `No such file or directory`. `SELFHOST.md:22` tells users to install via `foundryup`, which does land in `~/.foundry/bin`, but nothing enforces it and CI's `foundry-toolchain` action puts `forge` on `PATH` only.
**Fix:** Change line 2 to `set -euo pipefail`. Replace `~/.foundry/bin/forge` with `forge` and add a preflight `command -v forge >/dev/null || { echo "forge not found; install Foundry: https://getfoundry.sh"; exit 1; }`.
**Effort:** S

---

### REPO-32 — `dotenv-cli` is invoked by two packages that do not declare it

**Severity:** Low
**File:** `apps/web/package.json:7-9`, `packages/db/package.json:12-15`
**Problem:** `apps/web` runs `dotenv -e ../../.env -- next dev|build|start` and `packages/db` runs `dotenv -e ../../.env -- drizzle-kit ...`, but neither lists `dotenv-cli` in its dependencies. It resolves only because the root `package.json:23` has it as a devDependency and pnpm adds ancestor `node_modules/.bin` directories to `PATH`. `packages/indexer/package.json:24` does declare it, so the repo is internally inconsistent. Any change to hoisting settings, or running these scripts outside `pnpm run`, breaks them.
**Fix:** Add `"dotenv-cli": "^11.0.0"` to the devDependencies of `apps/web` and `packages/db`, matching `packages/indexer`.
**Effort:** S

---

### REPO-33 — `packages/sdk` declares a `workspace:*` dependency, contradicting the project's own stated invariant

**Severity:** Low
**File:** `packages/sdk/package.json:48`
**Problem:** CLAUDE.md's invariant list states "`packages/sdk` is monorepo-dep-free. Its `package.json` lists only `viem` and similar externals. If a PR adds a `workspace:*` dep to sdk, it's wrong." `packages/sdk/package.json:48` has `"@paylix/config": "workspace:*"` in `devDependencies`. In practice it is used only for `tsconfig.json:2` (`extends: "@paylix/config/tsconfig.node.json"`) — `packages/sdk/src/networks.ts:11` confirms the runtime data is deliberately duplicated — so the published tarball is unaffected. But the manifest as written will trip anyone enforcing the invariant mechanically, and a future contributor reading it will assume runtime imports are permitted.
**Fix:** Either inline the four compiler options into `packages/sdk/tsconfig.json` and drop the dependency, or amend the invariant in CLAUDE.md to say "no workspace `dependencies`; a devDependency on `@paylix/config` for tsconfig inheritance is allowed."
**Effort:** S

---

### REPO-34 — Declared version ranges drift across packages for four shared dependencies

**Severity:** Low
**File:** `packages/solana-indexer/package.json:15-22`, `packages/utxo-indexer/package.json:12-19`, `packages/solana-program/package.json:15`
**Problem:** `drizzle-orm` is `^0.38` in `apps/web`/`packages/db`/`packages/indexer` but `^0.38.4` in `packages/solana-indexer`/`packages/utxo-indexer`. `tsx` is `^4` in `packages/indexer` but `^4.21.0` in the two newer packages. `typescript` is `^5.5` in six packages, `^5.4.0` in `packages/solana-program`, and absent from `packages/config`, `solana-indexer`, `utxo-indexer` and `utxo-watcher` despite all four containing `.ts` source. All currently resolve to single versions in `pnpm-lock.yaml` (e.g. `drizzle-orm@0.38.4`), so this is style drift rather than a live duplication — but it is the mechanism by which duplication starts. See the drift table below.
**Fix:** Pick one range style per dependency and apply it everywhere; add a `pnpm.overrides` block in `pnpm-workspace.yaml` for `drizzle-orm`, `viem` and `@types/node` so transitive copies cannot diverge. Add `typescript` to the four packages missing it.
**Effort:** S

---

### REPO-35 — `packages/utxo-indexer` has zero tests and passes CI via `--passWithNoTests`

**Severity:** Low
**File:** `packages/utxo-indexer/package.json:10`
**Problem:** The test script is `vitest run --passWithNoTests`, and `git ls-files` confirms no `.test.ts` under `packages/utxo-indexer`. Every other workspace uses a bare `vitest run`. The package is the Bitcoin/Litecoin payment-detection writer — it consumes `@paylix/utxo-watcher` callbacks and writes payment rows — so "zero tests, reported green" is the least appropriate combination available. `packages/db` has no `test` script at all.
**Fix:** Either write tests for the session/address-derivation and payment-write paths, or drop the package from `pnpm test` until it has them, so the green tick is not misleading. Add a `test` script to `packages/db` covering at least schema-level invariants.
**Effort:** M

---

### REPO-36 — `package.json` description and README disagree on scope; SELFHOST cites a stale contract test count

**Severity:** Low
**File:** `package.json:4`, `packages/sdk/package.json:4`, `SELFHOST.md:112`
**Problem:** Both root and SDK manifests describe the project as "Accept USDC payments and subscriptions on Base", while `README.md:3` and the support matrix at `README.md:26-34` claim seven EVM chains plus Solana/Bitcoin/Litecoin scaffolds and six token types. The SDK description is what npm shows on the package page. Separately, `SELFHOST.md:112` says `deploy.sh` "Runs the full 118-test suite"; `packages/contracts/test/` contains 123 non-fork test functions plus 2 fork tests. Hardcoded counts go stale on every PR — `README.md:190` has the same problem with "527+ tests" (actual: 581 TS cases).
**Fix:** Update both `description` fields to match README's scope. Remove the hardcoded test counts from `SELFHOST.md:112` and `README.md:190`, or replace them with "the full suite".
**Effort:** S

---

### REPO-37 — Workflow trigger branches are inconsistent (`master` vs `main, master`)

**Severity:** Low
**File:** `.github/workflows/slither.yml:19`, vs `web-test.yml:23`, `forge-test.yml:14`, `anchor-test.yml:20`, `drizzle-check.yml:21`, `gitleaks.yml:17`
**Problem:** `slither.yml` triggers on push to `[main, master]`; the other five trigger on `[master]` only. The repository's default branch is `master`. If the project ever renames to `main` (the GitHub default for new repos, and a common OSS expectation), five of six workflows stop running on push and nobody notices, because PR triggers still fire.
**Fix:** Standardise all six on the same branch list. Since the branch is `master`, either use `[master]` everywhere or `[main, master]` everywhere.
**Effort:** S

---

### REPO-38 — Gitleaks PR commenting cannot work on fork PRs

**Severity:** Low
**File:** `.github/workflows/gitleaks.yml:39-42`
**Problem:** The step passes `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` with the comment "used to post scan results as PR comments". On `pull_request` runs from a forked repository — the normal case for outside contributions to an OSS project — GitHub issues a read-only token, so the comment API call fails. The scan itself still runs and still fails the job, which is the important part, but the log will show a confusing permission error on every external PR. (The workflow correctly uses `pull_request` rather than `pull_request_target`, so there is no untrusted-checkout privilege escalation here.)
**Fix:** Drop the `GITHUB_TOKEN` env and rely on the job's exit code, or split PR commenting into a separate `workflow_run`-triggered job that has the elevated token and does not check out untrusted code.
**Effort:** S

---

### REPO-39 — No `Cargo.lock` committed for the Solana workspace

**Severity:** Low
**File:** `packages/solana-program/Cargo.toml`, `.github/workflows/anchor-test.yml:52`
**Problem:** `git ls-files | grep Cargo` returns three `Cargo.toml` files and no `Cargo.lock`. `anchor-test.yml:52` builds a cache key from `hashFiles('packages/solana-program/**/Cargo.lock', 'packages/solana-program/**/Cargo.toml')`, so the lock component contributes nothing and the cache key changes only on manifest edits. More importantly, `cargo test --workspace --all-features` (line 55) resolves fresh dependency versions on every run, so a compromised or semver-breaking upstream crate lands without review — the same supply-chain risk the workflows carefully guard against on the Actions side by pinning SHAs.
**Fix:** Commit `packages/solana-program/Cargo.lock` (Anchor workspaces are applications, not libraries — locks belong in git) and add `--locked` to the `cargo test` invocation.
**Effort:** S

---

### REPO-40 — `.gitignore` patterns `cache/`, `specs/`, `plans/` are unanchored and will silently swallow real directories

**Severity:** Low
**File:** `.gitignore:13`, `.gitignore:29-32`
**Problem:** Line 13 (`cache/`) and lines 29-32 (`docs/sdd/`, `docs/plans/`, `plans/`, `specs/`) are directory patterns without a leading path component, so git applies them at every depth. `plans/` and `specs/` in particular will ignore any future `packages/contracts/specs/`, `apps/docs/content/specs/`, or similar legitimate directory, and the contributor will get no error — just a file that never shows up in `git status`. Line 7 (`.env.*`) also swallows any `.env.production.example` or `.env.docker.example` template someone adds later, since only `.env.example` is negated.
**Fix:** Anchor the AI-artifact patterns to the paths they actually target (`/plans/`, `/specs/`, `/docs/plans/`) and scope `cache/` to `packages/contracts/cache/` — the contracts package already ignores it in its own `.gitignore:2`. Broaden the negation to `!.env*.example`.
**Effort:** S

---

### REPO-41 — CONTRIBUTING.md's contract-test instructions do not match the repository's own tooling

**Severity:** Low
**File:** `CONTRIBUTING.md:58-63`
**Problem:** The block says "Contract tests require Foundry (via WSL on Windows)" and then gives `cd packages/contracts && forge test`. On Windows that command does not work — CLAUDE.md and `README.md:196-200` both specify the `wsl bash -lc "... ~/.foundry/bin/forge test"` form, and `packages/contracts/package.json:11` exists solely to print that reminder. CONTRIBUTING also never mentions the Biome config, does not tell contributors to run `forge build --sizes`, and its "Running Tests" list omits `packages/mailer`, `packages/config`, `packages/utxo-watcher` and `packages/solana-indexer` — half the packages that have tests.
**Fix:** Give the actual Windows/WSL invocation alongside the POSIX one, list all test-bearing packages, and document the lint toolchain once REPO-05 is resolved.
**Effort:** S

---

## Dependency Version Drift

| Dependency | Versions in use | Where |
|---|---|---|
| `@types/node` | `25.5.2` (exact) | `apps/web:62`, `packages/indexer:23`, `packages/mailer:20`, `packages/sdk:49` |
| | `^20` | `packages/solana-indexer`, `packages/utxo-indexer`, `packages/utxo-watcher` |
| `drizzle-orm` | `^0.38` | `apps/web`, `packages/db`, `packages/indexer` |
| | `^0.38.4` | `packages/solana-indexer`, `packages/utxo-indexer` |
| `tsx` | `^4` | `packages/indexer` |
| | `^4.21.0` | `packages/solana-indexer`, `packages/utxo-indexer` |
| `typescript` | `^5.5` | `apps/docs`, `apps/web`, `packages/db`, `packages/indexer`, `packages/mailer`, `packages/sdk` |
| | `^5.4.0` | `packages/solana-program` |
| | *(not declared)* | `packages/config`, `packages/solana-indexer`, `packages/utxo-indexer`, `packages/utxo-watcher` |
| `dotenv-cli` | `^11.0.0` | root, `packages/indexer` |
| | *(used, undeclared)* | `apps/web` (scripts), `packages/db` (scripts) |
| `@paylix/config` | `dependencies` | `packages/indexer`, `packages/solana-indexer`, `packages/utxo-indexer` |
| | `devDependencies` (but imported at runtime) | `apps/web` — see REPO-10 |
| `viem` | `^2` | `apps/web`, `packages/config`, `packages/indexer`, `packages/sdk`, `packages/solana-indexer` — consistent |
| `vitest` | `^4.1.4` | all 8 test-bearing packages — consistent |
| `react` / `react-dom` | `^19` | `apps/web`, `apps/docs`, `packages/indexer`, `packages/mailer` — consistent |

No `latest` or `*` ranges are present anywhere in the workspace manifests.

## Quick Wins

- **REPO-01** — add a root `.dockerignore`; single file, removes the worst exposure in this report.
- **REPO-06** — widen the `web-test.yml` path filter to `packages/**`; four workspaces gain CI coverage in one line.
- **REPO-08** — add `globalDependencies: [".env"]` to `turbo.json`; one line, removes a wrong-chain-build failure mode.
- **REPO-17** — add `permissions: {contents: read}` to five workflows.
- **REPO-23** — add `"!.next/cache/**"` to `turbo.json` outputs.
- **REPO-24** — gitignore + `git rm --cached apps/docs/public/search-index.json`.
- **REPO-25** — add a root `.gitattributes` with `* text=auto eol=lf`.
- **REPO-26** — swap `git diff` for `git status --porcelain` in `drizzle-check.yml`.
- **REPO-31** — `set -euo pipefail` and drop the hardcoded `~/.foundry/bin/` path in `export-abi.sh`.
- **REPO-14** — drop in Contributor Covenant, two issue templates, a PR template, and a `CODEOWNERS`.
- **REPO-16** — fix the two env-var names in `foundry.toml`.
- **REPO-18** — replace the WalletConnect ID in `.env.example` with a placeholder.
