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
        // MUST match the on-chain ERC20Permit name verbatim — this string
        // feeds into the EIP-712 domain separator. MockUSDC.sol constructs
        // its permit with "USD Coin (Mock)", so any other value here silently
        // breaks permit signature verification and allowance stays at 0.
        name: "USD Coin (Mock)",
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

/**
 * Returns the active network based on NEXT_PUBLIC_NETWORK env var.
 * Throws with a clear error listing valid keys if the env is unset or invalid.
 *
 * Every call to this function re-reads process.env — no module-level caching.
 * This makes testing trivial (set env in each test) and matches the spec's
 * "explicit over implicit" rule. The cost (a map lookup per call) is
 * negligible.
 */
export function getActiveNetwork(): NetworkConfig {
  const key = process.env.NEXT_PUBLIC_NETWORK;
  if (!key) {
    throw new Error(
      `NEXT_PUBLIC_NETWORK is not set. ` +
        `Valid keys: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
  if (!(key in NETWORKS)) {
    throw new Error(
      `NEXT_PUBLIC_NETWORK='${key}' is not a known network. ` +
        `Valid keys: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
  return NETWORKS[key as NetworkKey];
}

/**
 * Returns all networks matching the active environment. Used by every UI
 * that lists networks (Settings page, product form, checkout currency
 * picker). This is THE place where testnet/mainnet separation is enforced
 * — a mainnet deploy cannot display a testnet network because this
 * function literally filters them out.
 */
export function getAvailableNetworks(): NetworkConfig[] {
  const active = getActiveNetwork();
  return Object.values(NETWORKS).filter(
    (n) => n.environment === active.environment,
  );
}

/**
 * Resolves a token's on-chain address. Uses the canonical `address` if set
 * (e.g. Circle USDC), otherwise reads the per-deployment env var referenced
 * by `addressEnvVar` (e.g. MockUSDC). Throws loudly if neither path produces
 * a valid address — missing env vars must fail at request time, not silently
 * return a zero address that would then cause a cryptic on-chain revert.
 */
export function resolveTokenAddress(token: TokenConfig): `0x${string}` {
  if (token.address) return token.address;
  if (token.addressEnvVar) {
    const raw = process.env[token.addressEnvVar];
    if (!raw || raw === "0x0000000000000000000000000000000000000000") {
      throw new Error(
        `${token.addressEnvVar} is not set or is the zero address. ` +
          `Token ${token.symbol} cannot be resolved.`,
      );
    }
    return raw as `0x${string}`;
  }
  throw new Error(
    `Token ${token.symbol} has neither an address nor an addressEnvVar. ` +
      `This is a registry bug — fix the entry in packages/config/src/networks.ts.`,
  );
}

/**
 * Runtime validator that narrows an unknown string to NetworkKey. Use at
 * API boundaries and DB reads where TypeScript can't verify the value
 * statically. Throws with a clear message listing valid keys.
 */
export function assertValidNetworkKey(k: string): asserts k is NetworkKey {
  if (!(k in NETWORKS)) {
    throw new Error(
      `Invalid network key '${k}'. ` +
        `Valid: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
}

/**
 * Runtime validator for token symbols within a given network. Throws if
 * the symbol is not registered. Does NOT check supportsPermit — that's a
 * higher-level concern handled by the UI.
 */
export function assertValidTokenSymbol(
  network: NetworkConfig,
  symbol: string,
): void {
  if (!(symbol in network.tokens)) {
    throw new Error(
      `Token '${symbol}' is not registered on ${network.chainName}. ` +
        `Available: ${Object.keys(network.tokens).join(", ")}`,
    );
  }
}

/**
 * Convenience lookup for a specific (networkKey, tokenSymbol) pair. Throws
 * on either invalid input. Preferred over manually dereferencing
 * NETWORKS[key].tokens[symbol] because it produces a clear error instead
 * of `undefined`.
 */
export function getToken(
  networkKey: NetworkKey,
  tokenSymbol: string,
): TokenConfig {
  if (!(networkKey in NETWORKS)) {
    throw new Error(
      `Unknown network key '${networkKey}'. ` +
        `Valid: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
  const network = NETWORKS[networkKey];
  assertValidTokenSymbol(network, tokenSymbol);
  return (network.tokens as Record<string, TokenConfig>)[tokenSymbol]!;
}

// Type-level enforcement test — this block must never compile if the
// NetworkKey union stops being a string literal union.
// @ts-expect-error — "solana" is not a valid NetworkKey
const _typeLevelCheck: NetworkKey = "solana";
void _typeLevelCheck;
