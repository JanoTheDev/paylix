# Self-hosting Paylix

Complete operator guide: prerequisites, per-chain deploy, starting services,
and onboarding the first merchant. Read [README.md](README.md) first for the
architectural overview.

## Who this is for

Anyone running their own Paylix instance — open-source self-hosters, agencies
running it for clients, or teams deploying an internal copy. Paylix is
AGPL-3.0: if you modify it and offer it as a hosted service to third parties,
you must open-source your changes.

## Prerequisites

### All setups
- **Node.js 20** — the version in [`.nvmrc`](.nvmrc), and what both Dockerfiles and CI use
- **pnpm 9.15.4** — pinned by the root `packageManager` field. `corepack enable pnpm` installs the exact version; a manually installed pnpm 10 will be refused by corepack
- **Docker + Docker Compose** — for the bundled Postgres, and for the container self-host path
- **PostgreSQL 15+** — only if you'd rather not use the bundled `postgres:16-alpine` container
- A crypto wallet app for testing (MetaMask, Rabby, or any EVM wallet)

### EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche)
- **Foundry** (`forge`, `cast`) — installed via `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Alchemy** or equivalent RPC provider — free tier OK for testnets, paid tier recommended for mainnet
- Native gas on each chain you deploy to (ETH on Ethereum / Base / Arb / OP, MATIC on Polygon, BNB on BSC, AVAX on Avalanche)

### Solana (optional — scaffolded, implementation pending)
- **solana-cli** — `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
- **anchor-cli 0.30.1** — `cargo install --git https://github.com/coral-xyz/anchor avm --force && avm install 0.30.1 && avm use 0.30.1`
- SOL for devnet (airdrop: `solana airdrop 2`) or mainnet (buy + transfer)

### Bitcoin / Litecoin (optional — scaffolded, implementation pending)
- A wallet that exposes BIP32 xpubs (Sparrow, Specter, Electrum, Ledger/Trezor)
- An Electrum backend URL (public or self-hosted electrs / fulcrum)

### Windows-specific
- Foundry must run under **WSL** — native Windows Foundry isn't supported by this repo's scripts. Prefix every `forge` / `cast` command with `wsl bash -lc "cd /mnt/c/<path>/paykit/packages/contracts && ~/.foundry/bin/<cmd>"`.
- Use `127.0.0.1` not `localhost` in `DATABASE_URL` — Windows resolves `localhost` to IPv6 first and Postgres auth fails.

## Step 1 — Clone and install

```bash
git clone https://github.com/JanoTheDev/paylix.git
cd paylix
pnpm install
```

## Step 2 — Configure `.env`

```bash
cp .env.example .env
```

Minimum fields to fill (see the file itself for the full annotated list):

### Always required
- `DATABASE_URL` — Postgres connection string (use `127.0.0.1`, not `localhost`, on Windows)
- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
- `NEXT_PUBLIC_NETWORK` — active chain (e.g. `base-sepolia`, `arbitrum`, `ethereum`)
- `KEEPER_PRIVATE_KEY` — **unprefixed.** `packages/indexer/src/config.ts` calls
  `requireEnv("KEEPER_PRIVATE_KEY")`, so the indexer refuses to boot without it
- `RELAYER_PRIVATE_KEY` — **unprefixed.** Read by `apps/web/lib/relayer.ts`;
  gasless checkout fails without it

> The running services read the *unprefixed* `KEEPER_PRIVATE_KEY` and
> `RELAYER_PRIVATE_KEY` — the `TESTNET_*` / `MAINNET_*` variants below exist
> to keep the two environments' wallets separated on paper. Copy whichever
> group is active into the unprefixed names before starting web and indexer.

### Per-chain (fill only the group you use)
- `${CHAIN_KEY}_RPC_URL`
- `${CHAIN_KEY}_PAYMENT_VAULT` (paste from the Step 3 deploy output)
- `${CHAIN_KEY}_SUBSCRIPTION_MANAGER` (paste from the Step 3 deploy output)
- the testnet MockUSDC address — see the table below

A group is "active" as soon as any one of its three vars is set, at which
point all three are required — see `parseDeployments()` in
`packages/config/src/deployments.ts`.

#### Testnet MockUSDC address

Set the `NEXT_PUBLIC_*` variable from this table. **The names are not
derivable from the chain key** — base-sepolia has no chain infix at all, and
Fuji is `FUJI`, not `AVALANCHE_FUJI`. Guessing the pattern sets a variable
nothing reads, and checkout then resolves no token.

| Testnet | Variable (`packages/config/src/networks/`) |
|---------|--------------------------------------------|
| Base Sepolia | `NEXT_PUBLIC_MOCK_USDC_ADDRESS` |
| Ethereum Sepolia | `NEXT_PUBLIC_ETHEREUM_SEPOLIA_MOCK_USDC_ADDRESS` |
| Arbitrum Sepolia | `NEXT_PUBLIC_ARBITRUM_SEPOLIA_MOCK_USDC_ADDRESS` |
| OP Sepolia | `NEXT_PUBLIC_OP_SEPOLIA_MOCK_USDC_ADDRESS` |
| Polygon Amoy | `NEXT_PUBLIC_POLYGON_AMOY_MOCK_USDC_ADDRESS` |
| BNB Testnet | `NEXT_PUBLIC_BNB_TESTNET_MOCK_USDC_ADDRESS` |
| Avalanche Fuji | `NEXT_PUBLIC_FUJI_MOCK_USDC_ADDRESS` |

`${CHAIN_KEY}_MOCK_USDC_ADDRESS` (e.g. `BASE_SEPOLIA_MOCK_USDC_ADDRESS`) is a
**deprecated** server-side fallback. It still works, but
`apps/web/lib/deployment.ts` logs a deprecation warning when it is used —
prefer the `NEXT_PUBLIC_*` name above, which both the server and the checkout
bundle read.

Chain keys follow the `.env.example` template: `BASE_SEPOLIA`, `BASE`, `ETHEREUM`, `ETHEREUM_SEPOLIA`, `ARBITRUM`, `ARBITRUM_SEPOLIA`, `OP_SEPOLIA`, `OPTIMISM`, `POLYGON`, `POLYGON_AMOY`, `BNB`, `BNB_TESTNET`, `AVALANCHE`, `AVALANCHE_FUJI`.

### Testnet keys
- `TESTNET_DEPLOYER_PRIVATE_KEY` — passed to the deploy script as `DEPLOYER_PRIVATE_KEY`
- `TESTNET_RELAYER_PRIVATE_KEY` — copy into `RELAYER_PRIVATE_KEY` for the running app
- `TESTNET_KEEPER_PRIVATE_KEY` — copy into `KEEPER_PRIVATE_KEY` for the indexer
- `TESTNET_PLATFORM_WALLET` — passed to the deploy script as `PLATFORM_WALLET`
- `MOCK_USDC_MINTER_PRIVATE_KEY` — **unprefixed**; `apps/web/lib/faucet.ts` reads this exact name for the in-dashboard testnet faucet. It must be the key that deployed MockUSDC, because `MockUSDC.mint()` is `onlyOwner`

### Mainnet keys (NEVER reuse testnet values)
- `MAINNET_DEPLOYER_PRIVATE_KEY` — store cold after deploy; only reload for emergency pause/rotate
- `MAINNET_RELAYER_PRIVATE_KEY`
- `MAINNET_KEEPER_PRIVATE_KEY`
- `MAINNET_PLATFORM_WALLET` — MUST be a Safe multisig on mainnet

Generate a new wallet with:
```bash
wsl bash -lc "~/.foundry/bin/cast wallet new"
```

## Step 3 — Deploy contracts

Deployment is two Foundry scripts run directly — there is no wrapper script in
this repository, and nothing writes addresses back into `.env` for you.

| Script | Deploys | Extra env |
|--------|---------|-----------|
| [`script/DeployTestnet.s.sol`](packages/contracts/script/DeployTestnet.s.sol) | MockUSDC + `PaymentVault` + `SubscriptionManager` | — |
| [`script/DeployMainnet.s.sol`](packages/contracts/script/DeployMainnet.s.sol) | `PaymentVault` + `SubscriptionManager` | `USDC_ADDRESS`, `MULTISIG_OWNER` |

Both read `DEPLOYER_PRIVATE_KEY`, `PLATFORM_WALLET` and `RELAYER_ADDRESS` from
the process environment, hardcode the platform fee at 50 bps (0.5 %), accept
the USDC token on both contracts, and call `setRelayer()` on both.

`MULTISIG_OWNER` is read with `vm.envAddress` — there is no default, so the
mainnet script **aborts before broadcasting** with
`environment variable "MULTISIG_OWNER" not found` if you omit it. It must also
differ from the deployer EOA (`require(multisig != deployer)` at
`DeployMainnet.s.sol:45`), so you cannot pass your own deployer address to get
past the check.

Fund the deployer wallet with native gas on the chain you're targeting, then:

```bash
cd packages/contracts
set -a; . ../../.env; set +a           # load the root .env into this shell

# RELAYER_ADDRESS is blank in .env.example — derive it from the private key:
export TESTNET_RELAYER_ADDRESS=$(cast wallet address \
  --private-key "$TESTNET_RELAYER_PRIVATE_KEY")

# ── Testnet (free — fund the deployer from the chain's faucet) ──
DEPLOYER_PRIVATE_KEY=$TESTNET_DEPLOYER_PRIVATE_KEY \
PLATFORM_WALLET=$TESTNET_PLATFORM_WALLET \
RELAYER_ADDRESS=$TESTNET_RELAYER_ADDRESS \
forge script script/DeployTestnet.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast -vv
```

Mainnet is the same script family with the `MAINNET_*` key group, the chain's
canonical USDC address (from `packages/config/src/networks/<chain>.ts`), and
the multisig that will own the contracts:

```bash
DEPLOYER_PRIVATE_KEY=$MAINNET_DEPLOYER_PRIVATE_KEY \
PLATFORM_WALLET=$MAINNET_PLATFORM_WALLET \
RELAYER_ADDRESS=$MAINNET_RELAYER_ADDRESS \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
MULTISIG_OWNER=0xYourSafeMultisigAddress \
forge script script/DeployMainnet.s.sol \
  --rpc-url "$BASE_RPC_URL" --broadcast -vv
```

### Mainnet only — finish the ownership handoff

The contracts use OpenZeppelin `Ownable2Step`. The deploy script calls
`transferOwnership(MULTISIG_OWNER)`, which only makes the multisig the
**pending** owner. Until the multisig calls `acceptOwnership()`, the hot
deployer EOA is still the owner of both contracts — it can pause them, change
the fee, and rotate the relayer. The script says so in its final log lines:

```
Ownership transfer PENDING to multisig: 0x...
ACTION REQUIRED: multisig must call acceptOwnership() on both contracts.
Until then the deployer EOA is still owner: 0x...
```

From the multisig (Safe → New transaction → Contract interaction, or
`cast send` if the owner is a hardware wallet), call `acceptOwnership()` on
**both** contracts — two separate transactions:

```
acceptOwnership()   on <PAYMENT_VAULT_ADDRESS>
acceptOwnership()   on <SUBSCRIPTION_MANAGER_ADDRESS>
```

Then verify the handoff actually landed before you move the deployer key to
cold storage:

```bash
cast call <PAYMENT_VAULT_ADDRESS>        "owner()(address)" --rpc-url "$BASE_RPC_URL"
cast call <SUBSCRIPTION_MANAGER_ADDRESS> "owner()(address)" --rpc-url "$BASE_RPC_URL"
# Both must return MULTISIG_OWNER, not the deployer EOA.
```

The deploy is not complete until both calls return the multisig.

> Don't use the `--rpc-url base_sepolia` / `--rpc-url base` aliases from
> `packages/contracts/foundry.toml`: they interpolate `${RPC_URL}` and
> `${BASE_MAINNET_RPC_URL}`, neither of which exists in `.env.example`. Pass
> the URL (or the real `${CHAIN_KEY}_RPC_URL` var) explicitly.

Afterwards, by hand:

1. Copy the printed `PaymentVault`, `SubscriptionManager` and (testnet)
   `MockUSDC` addresses into the matching `${CHAIN_KEY}_*` vars in `.env`.
   MockUSDC also needs its `NEXT_PUBLIC_*_MOCK_USDC_ADDRESS` twin — the
   checkout bundle reads that one at build time.
2. Refresh the ABIs consumed by the web app and indexer:
   ```bash
   ./export-abi.sh          # writes packages/contracts/abi/*.json
   ```
   It calls `~/.foundry/bin/forge` explicitly (the `foundryup` / WSL default
   path); if your Foundry lives elsewhere, run `forge build` first and the
   script's extraction step will still work.
3. Run the contract suite before you trust a mainnet deploy:
   ```bash
   forge test                                    # macOS / Linux
   wsl bash -lc "cd /mnt/c/<path>/paykit/packages/contracts && ~/.foundry/bin/forge test"
   ```

### Gas to pre-fund per deploy
- Ethereum mainnet: ~0.05 ETH deployer + 0.1 ETH relayer + 0.1 ETH keeper
- L2s (Base / Arbitrum / Optimism): ~0.005 ETH each
- Polygon: ~5 MATIC
- BNB: ~0.05 BNB
- Avalanche: ~1 AVAX
- Testnets: free — grab from the chain's faucet

### Non-EVM deploys

**Solana.** The Anchor programs are in `packages/solana-program/`. Run
`anchor build` first — it generates a real keypair for each program at
`target/deploy/*.json` and writes the matching pubkey back into each
program's `declare_id!`. Then deploy with Anchor directly and record the
program IDs in your `.env` yourself:

```bash
cd packages/solana-program
anchor build
anchor deploy --provider.cluster devnet    # or mainnet-beta
anchor keys list                           # the IDs to put in .env
```

Before you ship to mainnet-beta, swap the placeholder IDs in
`programs/*/src/lib.rs` and `Anchor.toml` with `anchor keys list` output —
the hardcoded `Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS` +
`7xeFzZAtyq5uSVMAbx6N3LBhWFDCimbYhYdLdLg8EMmv` values are placeholders
used so the workspace compiles cleanly in CI.

**Bitcoin / Litecoin.** Nothing to deploy — the UTXO model is watch-address
only, so there are no contracts and no program IDs.
UTXO watcher (`@paylix/utxo-watcher`) is callback-
driven; wire your `loadSessions` / `persistDerivedAddress` / `onPayment` /
`onExpire` / `nextSessionIndex(xpub, sessionId)` / `onReorg?` against
whatever storage you run. `nextSessionIndex` must be atomic — the default
Drizzle implementation uses a Postgres advisory lock keyed on the xpub to
prevent two concurrent sessions from being handed the same BIP32 index.
`onReorg` is optional but recommended: it fires when a confirmed tx is no
longer on chain at its original height (rolled back by a reorg). Default
confirmation threshold is 6 on Bitcoin mainnet; override with
`UTXO_CONFIRMATIONS`. Default Electrum endpoints are baked into the
descriptors; override per merchant via `${CHAIN}_ELECTRUM_URL` env.

## Step 4 — Start services

### Option A: Docker

```bash
docker compose up -d
```

Brings up `web`, `indexer`, `postgres` as long-running services, with the
dashboard published on `:3000` and Postgres on `:5432`.

The schema is **not** created for you. The `web` image ships a standalone
Next.js server, not the pnpm workspace, so `drizzle-kit` isn't inside it — run
the push from the host against the published Postgres port:

```bash
pnpm install
pnpm --filter @paylix/db db:push        # or db:migrate for the SQL migrations
```

Don't run Option A and Option B at the same time: both bind `:3000`, and two
indexer processes would race on the same events.

### Option B: Pnpm (dev)

```bash
docker compose up -d postgres
pnpm --filter @paylix/db db:push
pnpm dev                                      # all apps + packages
# or individually:
pnpm --filter @paylix/web dev                 # dashboard :3000
pnpm --filter @paylix/indexer dev             # event listener + keeper
pnpm --filter @paylix/docs dev                # docs site :3001
```

### Multi-chain indexer

A **single** indexer process covers every chain. On boot it calls
`getDeployments()` (`packages/config/src/deployments.ts`), which scans the
environment for every `${CHAIN_KEY}_RPC_URL` / `_PAYMENT_VAULT` /
`_SUBSCRIPTION_MANAGER` group that is filled in and starts a listener per
group. Rows are written to the same Postgres tables keyed by `network_key`.

```bash
pnpm --filter @paylix/indexer start
```

So enabling another chain means filling in that chain's three env vars and
restarting the indexer — there is no per-chain process and no `CHAIN_KEY`
selector.

## Step 5 — First merchant setup

1. Open `http://localhost:3000`
2. Register an account
3. Navigate to **Settings → Payments**
4. Set the **default payout wallet** (any 0x address you control)
5. Enable the networks you want to accept payments on
6. Navigate to **Products → New product**
7. Add a price row: `Network → Base Sepolia`, `Token → USDC`, `Amount → 10.00`
8. Save → the product page gives you a **Generate checkout link** button

## Step 6 — Test the flow

On testnet, mint yourself some MockUSDC first. `MockUSDC.mint()` is
`onlyOwner`, and the owner is whichever key deployed it:

```bash
cast send "$BASE_SEPOLIA_MOCK_USDC_ADDRESS" "mint(address,uint256)" \
  0xYourBuyerWallet 1000000000 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$TESTNET_DEPLOYER_PRIVATE_KEY"
```

MockUSDC has 6 decimals, so `1000000000` is 1,000 USDC.

Then open the checkout link in a browser, connect the buyer wallet, and
complete the payment. The dashboard's **Payments** tab should show the tx
within 10 seconds (indexer confirmations + poll interval).

## Step 7 — Go live

Before accepting real payments:

- [ ] `acceptOwnership()` called by the multisig on **both** contracts, and `owner()` on each returns the multisig — do this **before** the next item
- [ ] Deployer key moved to cold storage (hardware wallet / paper backup)
- [ ] Platform wallet is a Safe multisig (app.safe.global — 5 minutes to set up)
- [ ] Testnet end-to-end verified with current code
- [ ] Bug bounty published (Immunefi Self-managed is free)
- [ ] Pause() runbook saved somewhere you can find at 3 AM
- [ ] Separate `MAINNET_*` keys — NONE reused from testnet
- [ ] BaseScan / Etherscan contract verification submitted per chain
- [ ] Alchemy paid tier for RPC (free tier throttles)

## Feature parity across chains

Every EVM chain supports all Paylix features once deployed:

| Feature                       | EVM chains        | Solana    | Bitcoin | Litecoin |
|-------------------------------|-------------------|-----------|---------|----------|
| One-time payments             | ✅                | 🚧 #57    | 🚧 #58  | 🚧 #59   |
| Subscriptions (EIP-2612)      | ✅                | ✅ (delegate) | ❌ (UTXO model)  | ❌ (UTXO model) |
| Subscriptions (Permit2)       | ✅                | ✅ (delegate) | ❌ (UTXO model)  | ❌ (UTXO model) |
| Subscriptions (DAI-permit)    | — (Ethereum DAI one-time only) | — | ❌ | ❌ |
| Free trials                   | ✅                | 🚧 #57    | ❌      | ❌       |
| Refunds (full + partial)      | ✅                | 🚧 #57    | 🚧 #58  | 🚧 #59   |
| Coupons                       | ✅                | 🚧 #57    | ❌      | ❌       |
| Tax collection (EU VAT / US)  | ✅                | ✅ (off-chain)  | ✅     | ✅       |
| Invoices + PDF receipts       | ✅                | ✅        | ✅      | ✅       |
| Webhooks                      | ✅                | 🚧 #57    | 🚧 #58  | 🚧 #59   |
| Customer portal               | ✅                | 🚧 #57    | Read-only | Read-only |
| Backup payer wallets          | ✅                | 🚧 #57    | ❌      | ❌       |
| Gasless checkout              | ✅                | ✅        | N/A (UTXO has no "gas" concept) | N/A |

Legend: ✅ live • 🚧 scaffolded, implementation tracked in the issue • ❌ out of scope by design

## Common troubleshooting

- **"Indexer offline" banner in dashboard** — check `pnpm --filter @paylix/indexer dev` is running and `${CHAIN}_RPC_URL` is reachable
- **"Permit already consumed" on retry** — expected; the vault's permit is single-use. Start a new checkout session.
- **Payments stay "pending" forever** — indexer isn't catching events. Check `INDEXER_CONFIRMATIONS` isn't higher than current chain confirmations, and that the indexer is reading from the deployed contract address.
- **Windows Postgres auth fails** — use `127.0.0.1` not `localhost` in `DATABASE_URL`.

## More docs

- **Project overview & supported chains:** [README.md](README.md)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security disclosure:** [SECURITY.md](SECURITY.md)
- **Developer docs site:** `pnpm --filter @paylix/docs dev` (serves on :3001)
- **Tracking issues:** #28 (multi-chain rollout), #56 (tokens), #57 (Solana), #58 (Bitcoin), #59 (Litecoin)
