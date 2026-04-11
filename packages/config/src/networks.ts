import type { Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

/**
 * Single source of truth for Paylix's supported networks and tokens.
 * Every file that previously hardcoded `baseSepolia` / `"USDC"` / `84532`
 * should now read from this module. See
 * docs/superpowers/specs/2026-04-11-multi-chain-multi-token-design.md.
 */

export type NetworkKey = "base" | "base-sepolia";
// Add new networks to this union when adding entries to NETWORKS below.
// TypeScript catches mismatches between the union and the record keys via
// `satisfies Record<NetworkKey, NetworkConfig>` on the NETWORKS declaration.

export type Environment = "mainnet" | "testnet";

export interface TokenConfig {
  /** Symbol, also the key in NetworkConfig.tokens. */
  symbol: string;
  /** Display name shown to merchants and buyers. */
  name: string;
  /** Native decimals (6 for USDC, 18 for ETH/DAI, 8 for WBTC). */
  decimals: number;
  /** EIP-2612 permit support — required for the gasless flow. */
  supportsPermit: boolean;
  /** EIP-712 domain version — "1" for MockUSDC, "2" for Circle USDC on Base. */
  eip712Version: string;
  /** UI grouping flag. */
  isStable: boolean;
  /**
   * Canonical address. Set for well-known tokens (Circle USDC) where every
   * Paylix deployment uses the same address.
   */
  address?: `0x${string}`;
  /**
   * Env var name for per-deployment token addresses (MockUSDC on testnet).
   * Exactly one of `address` or `addressEnvVar` must be set — enforced at
   * module init and by unit tests.
   */
  addressEnvVar?: string;
}

export interface NetworkConfig {
  /** Duplicated from the map key so NetworkConfig can be passed around standalone. */
  key: NetworkKey;
  chainId: number;
  chainName: string;
  environment: Environment;
  viemChain: Chain;
  blockExplorer: string;
  displayLabel: string;
  tokens: Record<string, TokenConfig>;
}

/**
 * The registry. Adding a new network is a single entry here plus, if needed,
 * updating the NetworkKey union type.
 *
 * Testnet and mainnet live side-by-side — only one is active in any given
 * deployment, selected by NEXT_PUBLIC_NETWORK and filtered at runtime by
 * the active network's environment field (see getAvailableNetworks).
 */
export const NETWORKS = {
  // ── MAINNET ─────────────────────────────────────────────────
  "base": {
    key: "base",
    chainId: 8453,
    chainName: "Base",
    environment: "mainnet",
    viemChain: base,
    blockExplorer: "https://basescan.org",
    displayLabel: "Base (Mainnet)",
    tokens: {
      USDC: {
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        supportsPermit: true,
        // Circle's Base USDC uses EIP-712 domain version "2". Verified by
        // PaymentVaultMainnetFork.t.sol against the real contract.
        eip712Version: "2",
        isStable: true,
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    },
  },

  // ── TESTNET ─────────────────────────────────────────────────
  "base-sepolia": {
    key: "base-sepolia",
    chainId: 84532,
    chainName: "Base Sepolia",
    environment: "testnet",
    viemChain: baseSepolia,
    blockExplorer: "https://sepolia.basescan.org",
    displayLabel: "Base Sepolia (Testnet)",
    tokens: {
      USDC: {
        symbol: "USDC",
        // "Mock USDC" makes the UI explicit that this is not real USDC.
        name: "Mock USDC",
        decimals: 6,
        supportsPermit: true,
        // MockUSDC contract (src/MockUSDC.sol) uses the OpenZeppelin ERC20Permit
        // default EIP-712 domain version "1".
        eip712Version: "1",
        isStable: true,
        addressEnvVar: "NEXT_PUBLIC_MOCK_USDC_ADDRESS",
      },
    },
  },
} as const satisfies Record<NetworkKey, NetworkConfig>;
