# Paylix

> Open-source crypto payments infrastructure. Accept one-time and recurring crypto payments across 7 EVM chains (and more coming), with gasless checkout and non-custodial settlement.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## What is Paylix?

Self-hostable payments stack for one-time and recurring crypto billing:

- TypeScript SDK (`@paylix/sdk`)
- Hosted checkout + merchant dashboard (Next.js)
- On-chain settlement contracts (Foundry — Solidity)
- Indexer + keeper for event sync and subscription charging
- Multi-chain registry + deploy tooling

Designed to replace Stripe-like subscription billing with crypto-native
settlement — without custody, without sending funds through an intermediary,
and without requiring buyers to hold gas.

## Supported chains and coins

Live at the code level; per-chain mainnet deploys require the operator to
fund a deployer wallet and run the Foundry deploy script in
`packages/contracts/script/` against that chain (see
[Deploying to a new chain](#deploying-to-a-new-chain)).

| Chain              | Testnet                  | Mainnet | USDC | USDT | DAI  | WETH | WBTC | PYUSD |
|--------------------|--------------------------|---------|------|------|------|------|------|-------|
| Ethereum           | Sepolia                  | ✅      | ✅   | ✅   | ✅*  | ✅†  | ✅†  | ✅    |
| Base               | Base Sepolia             | ✅      | ✅   | —    | ✅   | ✅   | —    | —     |
| Arbitrum One       | Arbitrum Sepolia         | ✅      | ✅   | ✅   | ✅   | ✅   | ✅   | —     |
| Optimism           | OP Sepolia               | ✅      | ✅   | ✅   | ✅   | ✅   | ✅   | —     |
| Polygon PoS        | Polygon Amoy             | ✅      | ✅   | ✅   | ✅   | ✅†  | ✅   | —     |
| BNB Chain          | BNB Testnet              | ✅      | ✅†‡ | ✅†  | ✅†  | ✅†  | —    | —     |
| Avalanche C-Chain  | Avalanche Fuji           | ✅      | ✅   | ✅   | ✅†  | ✅†  | ✅   | —     |

`*` Ethereum DAI uses the legacy DAI-permit variant
`†` Bridged token (flagged in UI as non-canonical)
`‡` BNB USDC (Binance-Peg) is 18-decimal and inert pending Permit2 wiring (#56)

Non-EVM chains (scaffolded, live implementation tracked in open issues):

| Chain     | Testnet     | Mainnet | Model           | Subscriptions |
|-----------|-------------|---------|-----------------|---------------|
| Solana    | Devnet      | Scaffold | SPL + Anchor    | ✅ (delegate authority) |
| Bitcoin   | Testnet     | Scaffold | UTXO watch-addr  | ❌ (no on-chain auth)   |
| Litecoin  | Testnet     | Scaffold | UTXO watch-addr  | ❌ (no on-chain auth)   |

## Non-custodial by design

- Customer funds transfer on-chain **directly from buyer wallet to merchant wallet**
- Paylix never holds user balances in intermediary wallets
- The platform fee (if enabled) is split during the same on-chain payment
- Gasless flows still settle directly — the relayer pays gas, not custody

## Quick start (SDK)

```bash
npm install @paylix/sdk
```

```ts
import { Paylix } from "@paylix/sdk";

const paylix = new Paylix({
  apiKey: "sk_test_...",
  network: "base-sepolia",  // any supported network key
  backendUrl: "http://localhost:3000",
});

const { checkoutUrl } = await paylix.createCheckout({
  productId: "prod_abc",
  customerId: "user_123",
  successUrl: "https://myapp.com/success",
  cancelUrl: "https://myapp.com/cancel",
});

// Redirect the buyer. Hosted checkout handles wallet + signatures.
```

Subscriptions use the same shape:

```ts
const { checkoutUrl } = await paylix.createSubscription({
  productId: "prod_monthly",
  customerId: "user_123",
  successUrl: "https://myapp.com/success",
  cancelUrl: "https://myapp.com/cancel",
});
```

## Gasless checkout

Buyers never need gas to pay. The hosted checkout takes two signatures:

1. **EIP-2612 permit** (or Uniswap Permit2 for non-permit tokens like USDT /
   DAI / WETH) — authorises the vault to pull exactly the amount of tokens
   the checkout needs
2. **Paylix `PaymentIntent`** (or `SubscriptionIntent`) — EIP-712 binding to
   the exact merchant + amount + nonce so a compromised relayer cannot
   redirect funds

The relayer submits the transaction and pays gas. The contract's
`_consumePaymentIntent` runs **before** `safeTransferFrom` — this is the
invariant that makes the design non-catastrophic against a compromised relay.

## Core features

- **One-time payments** on every supported chain/token pair
- **Subscriptions** with keeper-driven recurring charges (EIP-2612 + Permit2)
- **Free trials** with trialing and trial-conversion lifecycle states
- **Refunds** (full and partial, merchant-initiated or customer-requested)
- **Coupons** (one-off, repeating, and forever discounts)
- **Gasless checkout** via relayer (no ETH required for buyers)
- **Multi-wallet customers** (primary + backup payers for subscription resilience)
- **Tax collection** (EU VAT, US state headline rates)
- **Invoices + receipts** (hosted pages + on-demand PDF)
- **Webhooks** for payment and subscription lifecycle events
- **Customer portal** (view history, manage subs, add wallets)
- **Dashboard + checkout links** (no-code launches)
- **Testnet + mainnet parity** on every supported chain
- **Self-hosting** with Docker Compose, full data ownership

## Monorepo layout

```
apps/
  web/            Next.js dashboard + API + checkout
  docs/           Next.js docs site

packages/
  sdk/            @paylix/sdk
  contracts/      Solidity (PaymentVault, SubscriptionManager, MockUSDC)
  db/             Drizzle schema + migrations
  indexer/        EVM event listener + subscription keeper
  mailer/         Invoice email delivery
  config/         Network registry (7 EVM chains) + tsconfig utilities
  utxo-watcher/   Bitcoin + Litecoin UTXO watch-address service (skeleton)
  utxo-indexer/   UTXO payment writer wiring utxo-watcher callbacks to the DB
  solana-program/ Anchor workspace (payment_vault + subscription_manager)
  solana-indexer/ Solana log listener + keeper (skeleton)
```

## Prerequisites

| Tool | Version | Needed for |
|------|---------|------------|
| Node.js | 20 (see [`.nvmrc`](.nvmrc)) | everything |
| pnpm | 9.15.4 (pinned via `packageManager`; `corepack enable pnpm` installs it) | everything |
| Docker + Docker Compose | any recent | Postgres, and the container self-host path |
| PostgreSQL | 15+ | only if you don't use the bundled Postgres container |
| Foundry (`forge`, `cast`) | latest via [`foundryup`](https://getfoundry.sh) | deploying or testing the Solidity contracts |
| anchor-cli + solana-cli | anchor 0.30.1 | only for the Solana scaffold |

On **Windows**, Foundry must run under WSL — native Windows Foundry is not
supported by this repo's scripts. Also use `127.0.0.1` rather than `localhost`
in `DATABASE_URL`: Windows resolves `localhost` to IPv6 first and Postgres auth
fails.

## Self-hosting

See **[SELFHOST.md](SELFHOST.md)** for the full guide, including contract
deployment and the per-chain env groups.

Quick version (Docker):

```bash
# 1. Clone + configure
git clone https://github.com/JanoTheDev/paylix.git && cd paylix
cp .env.example .env                  # fill in keys — see SELFHOST.md

# 2. Deploy the contracts for your chain and paste the printed addresses
#    into .env (see "Deploying to a new chain" below, or SELFHOST.md step 3)

# 3. Start web + indexer + postgres
docker compose up -d

# 4. Create the schema (run from the host — the web image ships a standalone
#    Next.js server, not the pnpm workspace)
pnpm install
pnpm --filter @paylix/db db:push
```

The dashboard is then on <http://localhost:3000>. For the pnpm dev-server path
instead of containers, see [Local development](#local-development) — do not run
both, they both bind port 3000.

### Deploying to a new chain

There is no wrapper script in this repo: deployment is two Foundry scripts,
[`script/DeployTestnet.s.sol`](packages/contracts/script/DeployTestnet.s.sol)
(also deploys a MockUSDC) and
[`script/DeployMainnet.s.sol`](packages/contracts/script/DeployMainnet.s.sol)
(additionally requires `USDC_ADDRESS` and `MULTISIG_OWNER`). Both read
`DEPLOYER_PRIVATE_KEY`, `PLATFORM_WALLET` and `RELAYER_ADDRESS` from the
environment and call `setRelayer()` on both contracts.

```bash
cd packages/contracts
set -a; . ../../.env; set +a          # load the root .env into the shell

# TESTNET_RELAYER_ADDRESS is blank in .env.example — derive it once:
export TESTNET_RELAYER_ADDRESS=$(cast wallet address \
  --private-key "$TESTNET_RELAYER_PRIVATE_KEY")

# Testnet — e.g. Arbitrum Sepolia
DEPLOYER_PRIVATE_KEY=$TESTNET_DEPLOYER_PRIVATE_KEY \
PLATFORM_WALLET=$TESTNET_PLATFORM_WALLET \
RELAYER_ADDRESS=$TESTNET_RELAYER_ADDRESS \
forge script script/DeployTestnet.s.sol \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --broadcast -vv
```

Copy the printed `PaymentVault` / `SubscriptionManager` / `MockUSDC` addresses
into the matching `${CHAIN_KEY}_*` vars in `.env`, then run
`packages/contracts/export-abi.sh` to refresh `packages/contracts/abi/` (it
invokes `~/.foundry/bin/forge`, the WSL/`foundryup` default path).

Mainnet uses `DeployMainnet.s.sol` and the `MAINNET_*` key group, plus two
env vars the testnet script does not take:

```bash
DEPLOYER_PRIVATE_KEY=$MAINNET_DEPLOYER_PRIVATE_KEY \
PLATFORM_WALLET=$MAINNET_PLATFORM_WALLET \
RELAYER_ADDRESS=$MAINNET_RELAYER_ADDRESS \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
MULTISIG_OWNER=0xYourSafeMultisigAddress \
forge script script/DeployMainnet.s.sol \
  --rpc-url "$BASE_RPC_URL" --broadcast -vv
```

`USDC_ADDRESS` is the chain's canonical USDC from
`packages/config/src/networks/<chain>.ts`. `MULTISIG_OWNER` has no default —
omit it and the script aborts before broadcasting — and it must not equal the
deployer EOA.

**The mainnet deploy is not finished when the script exits.** The contracts
are `Ownable2Step`, so the script only makes the multisig the *pending* owner.
The multisig must then call `acceptOwnership()` on **both** contracts, or the
hot deployer EOA remains the owner. See
[SELFHOST.md](SELFHOST.md#mainnet-only--finish-the-ownership-handoff).

Testnet and mainnet deployer / relayer / keeper / platform wallets are
**separate** — the `TESTNET_*` and `MAINNET_*` env groups enforce the split.

To fund a test buyer with MockUSDC (the deployer owns the mint):

```bash
cast send "$BASE_SEPOLIA_MOCK_USDC_ADDRESS" "mint(address,uint256)" \
  0xYourBuyer 1000000000 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$TESTNET_DEPLOYER_PRIVATE_KEY"
```

## Local development

```bash
pnpm install
docker compose up -d postgres
pnpm --filter @paylix/db db:push
pnpm dev                              # all apps + packages via turbo
```

## Testing

`pnpm test` fans out through turbo to every package with a `test` script.
That includes `@paylix/contracts`, whose script is now a real `forge test` —
so **a bare `pnpm test` fails unless `forge` is on your `PATH`**. On Windows,
where Foundry lives in WSL, run the TypeScript packages you care about
individually and drive `forge` separately (see below). `@paylix/solana-program`
has no `test` script at all; its Anchor suite is `test:anchor`.

```bash
pnpm test                             # everything — needs forge on PATH
pnpm --filter @paylix/sdk test        # single package
pnpm --filter @paylix/config test     # network registry
pnpm --filter @paylix/utxo-watcher test
```

Solidity / Foundry tests run under WSL on Windows:

```bash
wsl bash -lc "cd /mnt/c/path/to/paykit/packages/contracts && ~/.foundry/bin/forge test"
```

On macOS / Linux, `cd packages/contracts && forge test`.

Anchor (Solana) tests need `anchor-cli` installed, and live behind a separate
script name so `pnpm test` doesn't try to run them:

```bash
pnpm --filter @paylix/solana-program test:anchor
```

## Rollout status

The multi-chain rollout (tracker #28 + #54–#65) is **fully closed**. Every
EVM chain, token, signature scheme, and non-EVM scaffold is landed.

What buyers can pay with today via the hosted checkout:

| Scheme       | Tokens                         | One-time | Subscriptions |
|--------------|--------------------------------|----------|---------------|
| EIP-2612     | USDC (all EVM mainnets), PYUSD | ✅       | ✅            |
| Permit2      | USDT, WETH, WBTC, bridged DAI  | ✅       | ✅            |
| DAI-permit   | DAI on Ethereum mainnet        | ✅       | —             |
| SPL delegate | USDC / USDT / PYUSD on Solana  | ✅       | ✅ (scaffold)  |
| UTXO watch   | BTC, LTC                       | ✅       | — (model)     |

Everything above is wired end-to-end for EVM (checkout client → relay →
contract). Non-EVM (Solana / Bitcoin / Litecoin) has contract/program/
service implementations; operator deploys + Postgres writer plug-in to
complete. Writer interfaces are callback-based so you can drop Drizzle or
any other ORM in without changing the packages.

## Architecture deep-dive

- [SELFHOST.md](SELFHOST.md) — operator guide: prerequisites, deploy, services, going live
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup-to-PR walkthrough
- [SECURITY.md](SECURITY.md) — disclosure process and scope
- [Docs site](apps/docs) — hand-rolled Next.js docs (`pnpm --filter @paylix/docs dev`, :3001)
- [`packages/contracts/README.md`](packages/contracts/README.md) — contract layer notes

## License

[AGPL-3.0](LICENSE) — Free to use, self-host, modify. If you offer a modified
version as a hosted service, you must open-source your changes.
