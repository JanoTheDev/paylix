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
- **Node.js 20+** and **pnpm 10+**
- **PostgreSQL 15+** (or Docker Desktop — `docker compose` brings up a Postgres)
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
- Foundry must run under **WSL** — native Windows Foundry isn't supported. `deploy/lib/wsl.sh` bridges Git Bash → WSL automatically.
- Use `127.0.0.1` not `localhost` in `DATABASE_URL` — Windows IPv6 resolution breaks Postgres auth.

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
- `DATABASE_URL` — Postgres connection string
- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
- `NEXT_PUBLIC_NETWORK` — active chain (e.g. `base-sepolia`, `arbitrum`, `ethereum`)

### Per-chain (fill only the group you use)
- `${CHAIN_KEY}_RPC_URL`
- `${CHAIN_KEY}_PAYMENT_VAULT` (populated by deploy.sh after Step 3)
- `${CHAIN_KEY}_SUBSCRIPTION_MANAGER` (populated by deploy.sh)
- `${CHAIN_KEY}_MOCK_USDC_ADDRESS` (testnets only, populated by deploy.sh)

Chain keys follow the `.env.example` template: `BASE_SEPOLIA`, `BASE`, `ETHEREUM`, `ETHEREUM_SEPOLIA`, `ARBITRUM`, `ARBITRUM_SEPOLIA`, `OP_SEPOLIA`, `OPTIMISM`, `POLYGON`, `POLYGON_AMOY`, `BNB`, `BNB_TESTNET`, `AVALANCHE`, `AVALANCHE_FUJI`.

### Testnet keys
- `TESTNET_DEPLOYER_PRIVATE_KEY`
- `TESTNET_RELAYER_PRIVATE_KEY`
- `TESTNET_KEEPER_PRIVATE_KEY`
- `TESTNET_PLATFORM_WALLET`
- `TESTNET_MOCK_USDC_MINTER_PRIVATE_KEY`

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

`deploy.sh` lives **outside** the `paykit/` directory on purpose — operator
tooling never ends up in commits. Copy it up one level:

```bash
cp -r deploy.sh deploy/ ../
cd ..
```

Fund the deployer wallet with native gas on the chain you're targeting, then:

```bash
# Testnet (free — use faucets):
./deploy.sh base testnet
./deploy.sh arbitrum testnet

# Fan out across every configured testnet in one shot:
./deploy.sh all testnet

# Mainnet (real money — requires explicit confirmation prompt):
./deploy.sh base mainnet
```

The script:
1. Compiles contracts with Foundry
2. Runs the full 118-test suite
3. Deploys `PaymentVault` + `SubscriptionManager` (+ MockUSDC on testnets)
4. Exports ABIs
5. Writes the addresses back into `paykit/.env` under `${CHAIN_KEY}_*` keys
6. Prints next steps (relayer funding, etc.)

### Gas to pre-fund per deploy
- Ethereum mainnet: ~0.05 ETH deployer + 0.1 ETH relayer + 0.1 ETH keeper
- L2s (Base / Arbitrum / Optimism): ~0.005 ETH each
- Polygon: ~5 MATIC
- BNB: ~0.05 BNB
- Avalanche: ~1 AVAX
- Testnets: free — grab from the chain's faucet

### Non-EVM deploys

```bash
./deploy.sh solana devnet
./deploy.sh solana mainnet
./deploy.sh bitcoin testnet
./deploy.sh litecoin testnet
```

**Solana.** The Anchor programs are in `packages/solana-program/`. Run
`anchor build` first — it generates a real keypair for each program at
`target/deploy/*.json` and writes the matching pubkey back into each
program's `declare_id!`. Then `./deploy.sh solana <network>` runs
`anchor deploy` and saves the program IDs into your `.env`.

Before you ship to mainnet-beta, swap the placeholder IDs in
`programs/*/src/lib.rs` and `Anchor.toml` with `anchor keys list` output —
the hardcoded `Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS` +
`7xeFzZAtyq5uSVMAbx6N3LBhWFDCimbYhYdLdLg8EMmv` values are placeholders
used so the workspace compiles cleanly in CI.

**Bitcoin / Litecoin.** UTXO watcher (`@paylix/utxo-watcher`) is callback-
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

Brings up `web`, `indexer`, `postgres` as long-running services.

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

One indexer process per chain. Set `CHAIN_KEY` before starting:

```bash
CHAIN_KEY=base      pnpm --filter @paylix/indexer start &
CHAIN_KEY=arbitrum  pnpm --filter @paylix/indexer start &
CHAIN_KEY=optimism  pnpm --filter @paylix/indexer start &
```

Each reads its own `${CHAIN_KEY}_*` env group and writes to the same
Postgres tables keyed by `network_key`.

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

On testnet, mint yourself some MockUSDC first:

```bash
./deploy.sh base testnet --mint-only 0xYourBuyerWallet 1000000000
```

Then open the checkout link in a browser, connect the buyer wallet, and
complete the payment. The dashboard's **Payments** tab should show the tx
within 10 seconds (indexer confirmations + poll interval).

## Step 7 — Go live

Before accepting real payments:

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

- **Architecture & invariants:** [CLAUDE.md](CLAUDE.md)
- **Design specs:** [docs/superpowers/specs/](docs/superpowers/specs/)
- **Tracking issues:** #28 (multi-chain rollout), #56 (tokens), #57 (Solana), #58 (Bitcoin), #59 (Litecoin)
