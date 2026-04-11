/**
 * Thin re-export layer over @paylix/config/networks. Every file that used
 * to hardcode baseSepolia / base / 84532 should import from here.
 *
 * No module-level caching of process.env — each call to getActiveNetwork()
 * re-reads the env. This matches the spec's "explicit over implicit" rule.
 */

import {
  getActiveNetwork,
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
