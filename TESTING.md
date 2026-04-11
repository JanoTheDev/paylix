# Paylix — Testnet Testing Guide

This guide walks through setting up Paylix end-to-end on Base Sepolia testnet so you can test real payment flows without spending real money.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker Desktop (or local PostgreSQL)
- WSL + Foundry (for smart contract deployment)
- MetaMask browser extension
- A Reown Cloud account for WalletConnect (free)
- An Alchemy account for RPC access (free)

---

## 1. Clone and Install

```bash
git clone https://github.com/JanoTheDev/paylix.git
cd paylix
pnpm install
```

---

## 2. Set Up PostgreSQL

**Option A: Docker**
```bash
docker compose up -d postgres
```

**Option B: Local Postgres**
Create a database named `paylix` and use your local credentials in `.env`.

> **Windows note:** use `127.0.0.1` instead of `localhost` in your connection string — Windows has IPv6 resolution issues with localhost.

---

## 3. Create MetaMask Test Accounts

You need three separate MetaMask accounts for a full test:

| Account | Role | Purpose |
|---|---|---|
| **Seller** | Platform owner | Deploys contracts, receives 0.5% platform fee |
| **Merchant** | Store owner | Receives 99.5% of payments |
| **Buyer** | Customer | Makes payments |

In MetaMask: click the account icon → "Add account" → create three accounts. Name them accordingly.

### Add Base Sepolia network

If Base Sepolia isn't in MetaMask:
- Settings → Networks → Add Network → Add network manually
- Network name: `Base Sepolia`
- RPC URL: `https://sepolia.base.org`
- Chain ID: `84532`
- Currency: `ETH`
- Block explorer: `https://sepolia.basescan.org`

---

## 4. Get Free Testnet ETH

Both **Seller** and **Buyer** need Base Sepolia ETH for gas fees.

**Superchain Faucet** (no mainnet balance required):
https://app.optimism.io/faucet — sign in with GitHub, select Base Sepolia, paste each address.

You only need ~0.005 ETH per account. Plenty for hundreds of transactions.

---

## 5. Get API Keys

### Alchemy (RPC)
1. Go to https://www.alchemy.com
2. Create a free account
3. Create a new app → select **Base** network
4. Copy the API key — you'll use the Base Sepolia endpoint:
   `https://base-sepolia.g.alchemy.com/v2/YOUR_KEY`

### Reown Cloud (WalletConnect)
1. Go to https://cloud.reown.com
2. Sign up (free)
3. Create a new project
4. Copy the **Project ID** from the dashboard

---

## 6. Configure `.env`

Copy the example and fill in:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Database (use 127.0.0.1 on Windows)
DB_PASSWORD=paylix_dev
DATABASE_URL=postgresql://paylix:paylix_dev@127.0.0.1:5432/paylix

# Auth — generate a random secret
BETTER_AUTH_SECRET=run_openssl_rand_base64_32_to_generate
BETTER_AUTH_URL=http://localhost:3000

# Blockchain
NEXT_PUBLIC_NETWORK=base-sepolia
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# Contract addresses — filled in after step 8
PAYMENT_VAULT_ADDRESS=0x0000000000000000000000000000000000000000
SUBSCRIPTION_MANAGER_ADDRESS=0x0000000000000000000000000000000000000000
MOCK_USDC_ADDRESS=0x0000000000000000000000000000000000000000
NEXT_PUBLIC_PAYMENT_VAULT_ADDRESS=0x0000000000000000000000000000000000000000
NEXT_PUBLIC_SUBSCRIPTION_MANAGER_ADDRESS=0x0000000000000000000000000000000000000000
NEXT_PUBLIC_MOCK_USDC_ADDRESS=0x0000000000000000000000000000000000000000

# Seller's private key (from MetaMask → Account details → Show private key)
DEPLOYER_PRIVATE_KEY=0xYOUR_SELLER_PRIVATE_KEY
KEEPER_PRIVATE_KEY=0xYOUR_SELLER_PRIVATE_KEY

# Seller's wallet address — receives platform fees
PLATFORM_WALLET=0xYOUR_SELLER_ADDRESS

# WalletConnect project ID
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_reown_project_id
```

> **Security warning:** never commit `.env` or share your private key publicly.

---

## 7. Push the Database Schema

```bash
pnpm --filter @paylix/db db:push
```

Type `y` when prompted. This creates all tables.

---

## 8. Deploy Smart Contracts

You need Foundry installed in WSL for this. The repo includes a wrapper that
compiles, tests, deploys, exports ABIs, and rewrites the addresses in your
`.env` automatically:

```bash
./deploy-contracts.sh
```

It reads `DEPLOYER_PRIVATE_KEY`, `PLATFORM_WALLET`, `RELAYER_PRIVATE_KEY`,
and `RPC_URL` from `.env`, derives `RELAYER_ADDRESS` from the relayer key,
deploys MockUSDC + PaymentVault + SubscriptionManager, and prints the three
addresses. Both the server-side and `NEXT_PUBLIC_*` env vars are updated in
place — no manual copy-paste.

If the relayer key isn't in `.env` yet, generate one first:

```bash
wsl bash -lc "~/.foundry/bin/cast wallet new"
# add the printed private key to .env as RELAYER_PRIVATE_KEY=0x...
```

---

## 9. Mint Test USDC to the Buyer

Use `cast` to mint 1000 test USDC to the Buyer's address:

```bash
wsl bash -lc "~/.foundry/bin/cast send 0xMOCK_USDC_ADDRESS \
  'mint(address,uint256)' \
  0xBUYER_ADDRESS \
  1000000000 \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY \
  --private-key 0xSELLER_PRIVATE_KEY"
```

The `1000000000` = 1000 USDC (USDC has 6 decimals).

---

## 10. Import USDC Token in MetaMask

For each account (Seller, Merchant, Buyer):

1. Switch to Base Sepolia network
2. Scroll down → "Import tokens"
3. Custom token tab
4. Contract address: the `MOCK_USDC_ADDRESS` from deployment
5. Symbol: `USDC`
6. Decimals: `6`
7. Import

The Buyer should now show 1000 USDC.

---

## 11. Start the Services

Open three terminals:

**Terminal 1 — Web dashboard:**
```bash
pnpm --filter @paylix/web dev
```

**Terminal 2 — Blockchain indexer:**
```bash
pnpm --filter @paylix/indexer dev
```

**Terminal 3 (optional) — Docs site:**
```bash
pnpm --filter @paylix/docs dev
```

---

## 12. Create a Merchant Account

1. Open http://localhost:3000
2. Click "Register"
3. Create an account with any email/password
4. You'll land on the dashboard

### Configure Settings
1. Go to **Settings** → paste the **Merchant** wallet address → Save
2. Check the sidebar — "Indexer online" should show green

---

## 13. Create a Test Product

1. Go to **Products** → "Create Product"
2. Name: `Test Product`
3. Type: `One-time`
4. Price: `100` (this is in cents, so $1.00)
5. Enable some checkout fields if you want (email, name, etc.)
6. Save

---

## 14. Generate a Checkout Link

Two ways:

**Option A: From the Products page**
- Click the link icon next to your product
- Copy the generated URL

**Option B: From the Checkout Links page**
- Go to **Checkout Links** → "Generate Link"
- Select the product → Generate
- Copy the URL

---

## 15. Make a Test Payment

1. **Switch MetaMask to the Buyer account**
2. Make sure Base Sepolia is selected
3. Open the checkout URL in your browser
4. Click **Connect Wallet** → choose MetaMask
5. Approve the connection in the MetaMask popup
6. Click **Pay $1.00 USDC**
7. MetaMask will pop up **two signatures** in a row (no transactions, no
   gas needed from the buyer):
   - First: an EIP-2612 USDC permit
   - Second: a Paylix `PaymentIntent` binding the merchant + amount
8. The page shows "Processing..." with a "do not close this window" notice
   while the relayer submits the on-chain transaction
9. The indexer picks up the event after `INDEXER_CONFIRMATIONS` blocks
   (~10s on Base with the default of 5)
10. The page redirects to the success URL

---

## 16. Verify Everything Worked

**In the dashboard:**
- **Payments** page → you should see the new payment with status `confirmed`
- **Customers** page → a new customer record with the Buyer's wallet address
- **Overview** page → revenue total increased
- **Checkout Links** page → status changed to `completed`

**In MetaMask:**
- **Merchant** account: balance increased by ~0.995 USDC
- **Seller** account: balance increased by ~0.005 USDC (platform fee)
- **Buyer** account: balance decreased by 1 USDC + a tiny bit of ETH for gas

**On BaseScan:**
https://sepolia.basescan.org/address/0xYOUR_MERCHANT_ADDRESS
- Check the "Token Transfers" tab to see the USDC transfer

**In the indexer terminal:**
You should see logs like:
```
[Handler] PaymentReceived: { ... }
[Handler] Matched checkout session ...
[Handler] Created payment ...
[Handler] Checkout session ... marked completed
```

---

## Troubleshooting

### "Payment processing unavailable" banner on checkout
The indexer isn't running. Start it: `pnpm --filter @paylix/indexer dev`

### MetaMask doesn't open when connecting
- Click the MetaMask extension icon directly in your browser toolbar
- Pin the extension for visibility
- Disconnect any existing connection: MetaMask → three dots → Connected sites → disconnect localhost

### Transaction reverts with "Token not accepted"
The MockUSDC address wasn't set as accepted in the PaymentVault. Re-run the deploy script, or manually call `setAcceptedToken` on the PaymentVault contract.

### Wrong network error
The checkout will auto-prompt a network switch. If it doesn't work, manually switch MetaMask to Base Sepolia before clicking Pay.

### "Password authentication failed" on db:push
Your `DATABASE_URL` uses `localhost` — change it to `127.0.0.1` on Windows.

### Need more test USDC
Run step 9 again with any address. MockUSDC has a public mint function, no limits.
