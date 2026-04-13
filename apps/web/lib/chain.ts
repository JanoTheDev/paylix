/**
 * Thin re-export layer over @paylix/config/networks. Every file that used
 * to hardcode baseSepolia / base / 84532 should import from here.
 *
 * No module-level caching of process.env — each call to getActiveNetwork()
 * re-reads the env. This matches the spec's "explicit over implicit" rule.
 */

import {
  getActiveNetwork,
  NETWORKS,
  type NetworkConfig,
  type NetworkKey,
} from "@paylix/config/networks";

const network = getActiveNetwork();

export const NETWORK: NetworkConfig = network;
export const NETWORK_KEY: NetworkKey = network.key;
export const CHAIN_ID: number = network.chainId;
export const CHAIN = network.viemChain;
export const IS_MAINNET: boolean = network.environment === "mainnet";

// The active network's default stablecoin. Today that's always USDC on both
// Base and Base Sepolia. When adding a network that doesn't have USDC, make
// sure it still has a "USDC" entry (or update the readers to pick another
// token — but for the current refactor USDC is the load-bearing default).
export const USDC_TOKEN = network.tokens.USDC;

// We DON'T use resolveTokenAddress() here even though it exists in the
// registry. Reason: Next.js only statically inlines direct literal
// `process.env.NEXT_PUBLIC_X` references in client bundles — dynamic
// `process.env[variableName]` lookups (which is what resolveTokenAddress
// does) get replaced with `undefined` at build time, so any client-side
// caller crashes with "not set or zero address" at runtime.
//
// Instead, resolve here with explicit env var references that Next can
// inline: canonical address if the token has one (mainnet USDC), otherwise
// a hardcoded fallthrough to NEXT_PUBLIC_MOCK_USDC_ADDRESS (testnet).
// When adding a new testnet network with its own MockUSDC env var, add a
// branch here.
export const USDC_ADDRESS: `0x${string}` = (USDC_TOKEN.address ??
  process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/**
 * Resolves a network config based on the caller's current mode.
 *
 * Test mode → base-sepolia
 * Live mode → base (mainnet)
 *
 * This is the per-request equivalent of the module-level `NETWORK` constant,
 * suitable for server components and API routes where mode is known at
 * request time. Client components stuck with build-time NEXT_PUBLIC_NETWORK
 * continue to use the `NETWORK` / `CHAIN` / etc. constants above until
 * Phase 3's checkout page retrofit lands.
 *
 * When additional chains are added, extend this mapping (or grow the signature
 * to take an optional `networkKey` parameter) so mode + chain pick the right
 * entry from `NETWORKS`.
 */
export function getNetworkForMode(livemode: boolean): NetworkConfig {
  return livemode ? NETWORKS["base"] : NETWORKS["base-sepolia"];
}
