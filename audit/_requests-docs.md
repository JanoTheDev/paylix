# Requests from the docs agent

Changes I could not make because the file is outside my ownership
(`apps/docs/**`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SELFHOST.md`,
`CODE_OF_CONDUCT.md`). All of these are documentation-accuracy defects I
verified against the code while fixing REPO-07 / REPO-30 / REPO-36.

## `.env.example` — references a file that does not exist

- `.env.example:87` — "Run `./deploy.sh <chain> <network>` from outside the repo
  — it deploys the contracts with Foundry and writes the addresses back here
  automatically." `deploy.sh` is not in the repository (`git ls-files | grep -i
  deploy` returns only the two `.s.sol` Foundry scripts). Replace with the real
  procedure now documented in `SELFHOST.md` step 3: run
  `forge script script/DeployTestnet.s.sol` (or `DeployMainnet.s.sol`) from
  `packages/contracts` and paste the printed addresses in by hand.
- `.env.example:212` — "The scripts in `deploy/evm.sh` read the group matching
  `./deploy.sh <chain> <network>`". `deploy/` does not exist. Delete or rewrite.
- `.env.example:247-249` — "Legacy (single-environment) keys — still honored as
  fallback… `deploy/evm.sh` falls back to the unprefixed names below."
  **This is backwards and it is the highest-impact defect in the file.** The
  unprefixed names are not legacy — they are the ONLY names the running
  services read:
  - `packages/indexer/src/config.ts:49` — `requireEnv("KEEPER_PRIVATE_KEY")`;
    the indexer refuses to boot without the unprefixed name.
  - `apps/web/lib/relayer.ts:6` — `process.env.RELAYER_PRIVATE_KEY`.
  - `apps/web/app/api/system/keeper-status/route.ts:9` —
    `process.env.KEEPER_PRIVATE_KEY`.
  Nothing anywhere reads `TESTNET_KEEPER_PRIVATE_KEY` or
  `MAINNET_RELAYER_PRIVATE_KEY`; those were only ever consumed by the missing
  wrapper script. An operator who fills in only the `TESTNET_*` group — which
  is what the file currently tells them to do — gets an indexer that crashes at
  startup. Uncomment `KEEPER_PRIVATE_KEY` / `RELAYER_PRIVATE_KEY` and label
  them as required.

## `.env.example` — wrong variable name for the faucet

- `.env.example:223-226` — `TESTNET_MOCK_USDC_MINTER_PRIVATE_KEY`. The code
  reads the **unprefixed** `MOCK_USDC_MINTER_PRIVATE_KEY`
  (`apps/web/lib/faucet.ts:19`). The dashboard faucet is silently dead with the
  documented name.
- Same block: the comment says "production testnets should use a dedicated
  minter via `MockUSDC.addMinter(address)`". `packages/contracts/src/MockUSDC.sol`
  has no `addMinter` — `mint()` is `onlyOwner` (line 15) and there is no role
  system. Remove the sentence.

## `.env.example` — live third-party credential (REPO-18)

- `.env.example:77` — `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` ships a concrete
  32-hex project ID rather than a placeholder. Replace with
  `YOUR_WALLETCONNECT_PROJECT_ID`, matching the `YOUR_ALCHEMY_KEY` convention
  on line 100. (The duplicate hardcoded fallback in `apps/web/lib/wagmi.ts:24`
  is the other half of this.)

## `packages/contracts/script/DeployMainnet.s.sol` — stale doc comment

- `DeployMainnet.s.sol:13-14` — "The outer `deploy.sh` sets `USDC_ADDRESS` from
  the active chain's canonical value in
  `packages/config/src/network-registry.ts` before invoking this."
  `deploy.sh` does not exist. This is now the last surviving reference to it in
  the tracked tree. Operators must set `USDC_ADDRESS` themselves — which is
  what `SELFHOST.md` step 3 and the docs site now tell them to do. Suggest:
  "Set `USDC_ADDRESS` from the active chain's canonical value in
  `packages/config/src/networks/<chain>.ts`."
- Consider `vm.envOr` with a loud `require` for `MULTISIG_OWNER`, or keep
  `vm.envAddress` but note that the failure mode is Foundry's generic
  `environment variable "MULTISIG_OWNER" not found`, which does not tell the
  operator what to do. The existing `require(multisig != deployer)` message is
  the right model.

## `packages/contracts/foundry.toml` (REPO-16)

- `foundry.toml:17-18` — `base_sepolia = "${RPC_URL}"` and
  `base = "${BASE_MAINNET_RPC_URL}"`. Neither variable exists in
  `.env.example`, which uses `BASE_SEPOLIA_RPC_URL` (line 100) and
  `BASE_RPC_URL` (line 108). The `--rpc-url base_sepolia` alias therefore
  resolves to an empty string. I have documented "pass the URL explicitly, do
  not use the aliases" in `SELFHOST.md`, but the aliases should be fixed and
  extended to the other twelve chains.

## `packages/contracts/export-abi.sh` (REPO-31)

- `export-abi.sh:10` — hardcodes `~/.foundry/bin/forge`. `SELFHOST.md` now
  tells operators to run this script; it fails for anyone whose Foundry is on
  `PATH` elsewhere (Homebrew, `/usr/local/bin`, CI's `foundry-toolchain`).
  Prefer `forge` with a `command -v forge` preflight.
- `export-abi.sh:2` — `set -e` only; add `-u -o pipefail`.

## `apps/docs/app/sdk-reference/webhooks/page.tsx` heading anchors

- The `SectionHeading` for `paylix.createWebhook()` (~line 54) passes no `id`
  prop, so there is no `#paylix-createwebhook` fragment to link to. I repointed
  `apps/docs/app/webhooks/page.tsx` at the page rather than a dead fragment.
  Whoever owns the docs component conventions may want `id` props on the
  per-method `SectionHeading`s so deep links work. (This one is inside my
  ownership; filed here only because it is a convention decision, not a defect.)

## Root manifest description (REPO-36)

- `package.json:4` and `packages/sdk/package.json:4` both describe the project
  as "Accept USDC payments and subscriptions on Base." README and the docs site
  now describe 7 EVM chains plus Solana/Bitcoin/Litecoin and six token types.
  The SDK description is what npm renders on the package page.
