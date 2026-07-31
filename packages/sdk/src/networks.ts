import type { NetworkConfig, PaylixNetwork } from "./types";

/**
 * Merchant-facing display metadata: explorer base URLs, public RPCs, and
 * the canonical USDC address where one exists. Purely informational —
 * nothing in this table moves money.
 *
 * Contract addresses are intentionally **not** here. The backend resolves
 * `PaymentVault` / `SubscriptionManager` from its own environment, and an
 * earlier version of this file exported the zero address for every chain,
 * which read as a real value to anyone who typed `NETWORKS.base.…`.
 *
 * `usdcAddress` is `null` on testnets and non-EVM chains, where the token
 * a deployment uses is deployment-specific. Ask the backend
 * (`GET /api/checkout/{id}`) rather than assuming.
 *
 * The SDK stays monorepo-dep-free per the package invariant, so this table
 * intentionally duplicates a subset of `@paylix/config` and MUST be kept
 * in sync when a chain is added.
 */
export const NETWORKS: Record<PaylixNetwork, NetworkConfig> = {
  // ── EVM mainnet ──────────────────────────────────────────────────
  ethereum: {
    chainId: 1,
    isEvm: true,
    rpcUrl: "https://eth.llamarpc.com",
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    explorerUrl: "https://etherscan.io",
  },
  base: {
    chainId: 8453,
    isEvm: true,
    rpcUrl: "https://mainnet.base.org",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorerUrl: "https://basescan.org",
  },
  arbitrum: {
    chainId: 42161,
    isEvm: true,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    explorerUrl: "https://arbiscan.io",
  },
  optimism: {
    chainId: 10,
    isEvm: true,
    rpcUrl: "https://mainnet.optimism.io",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    explorerUrl: "https://optimistic.etherscan.io",
  },
  polygon: {
    chainId: 137,
    isEvm: true,
    rpcUrl: "https://polygon-rpc.com",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    explorerUrl: "https://polygonscan.com",
  },
  bnb: {
    chainId: 56,
    isEvm: true,
    rpcUrl: "https://bsc-dataseed.bnbchain.org",
    usdcAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    explorerUrl: "https://bscscan.com",
  },
  avalanche: {
    chainId: 43114,
    isEvm: true,
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    explorerUrl: "https://snowtrace.io",
  },

  // ── EVM testnet ──────────────────────────────────────────────────
  // `usdcAddress` is null: test deployments each mint their own mock USDC.
  "ethereum-sepolia": {
    chainId: 11155111,
    isEvm: true,
    rpcUrl: "https://rpc.sepolia.org",
    usdcAddress: null,
    explorerUrl: "https://sepolia.etherscan.io",
  },
  "base-sepolia": {
    chainId: 84532,
    isEvm: true,
    rpcUrl: "https://sepolia.base.org",
    usdcAddress: null,
    explorerUrl: "https://sepolia.basescan.org",
  },
  "arbitrum-sepolia": {
    chainId: 421614,
    isEvm: true,
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    usdcAddress: null,
    explorerUrl: "https://sepolia.arbiscan.io",
  },
  "op-sepolia": {
    chainId: 11155420,
    isEvm: true,
    rpcUrl: "https://sepolia.optimism.io",
    usdcAddress: null,
    explorerUrl: "https://sepolia-optimism.etherscan.io",
  },
  "polygon-amoy": {
    chainId: 80002,
    isEvm: true,
    rpcUrl: "https://rpc-amoy.polygon.technology",
    usdcAddress: null,
    explorerUrl: "https://amoy.polygonscan.com",
  },
  "bnb-testnet": {
    chainId: 97,
    isEvm: true,
    rpcUrl: "https://bsc-testnet.publicnode.com",
    usdcAddress: null,
    explorerUrl: "https://testnet.bscscan.com",
  },
  "avalanche-fuji": {
    chainId: 43113,
    isEvm: true,
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    usdcAddress: null,
    explorerUrl: "https://testnet.snowtrace.io",
  },

  // ── Non-EVM ──────────────────────────────────────────────────────
  // `chainId` is 0 and `isEvm` is false: these chains have no EVM chain ID
  // and no ERC-20 USDC contract. Token addresses come from the backend.
  solana: {
    chainId: 0,
    isEvm: false,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    usdcAddress: null,
    explorerUrl: "https://solscan.io",
  },
  "solana-devnet": {
    chainId: 0,
    isEvm: false,
    rpcUrl: "https://api.devnet.solana.com",
    usdcAddress: null,
    explorerUrl: "https://solscan.io/?cluster=devnet",
  },
  bitcoin: {
    chainId: 0,
    isEvm: false,
    rpcUrl: "",
    usdcAddress: null,
    explorerUrl: "https://mempool.space",
  },
  "bitcoin-testnet": {
    chainId: 0,
    isEvm: false,
    rpcUrl: "",
    usdcAddress: null,
    explorerUrl: "https://mempool.space/testnet",
  },
  litecoin: {
    chainId: 0,
    isEvm: false,
    rpcUrl: "",
    usdcAddress: null,
    explorerUrl: "https://live.blockcypher.com/ltc",
  },
  "litecoin-testnet": {
    chainId: 0,
    isEvm: false,
    rpcUrl: "",
    usdcAddress: null,
    explorerUrl: "https://chain.so/testnet/LTC",
  },
};
