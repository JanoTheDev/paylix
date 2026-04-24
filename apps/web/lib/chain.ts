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
  type TokenConfig,
} from "@paylix/config/networks";

const network = getActiveNetwork();

export const NETWORK: NetworkConfig = network;
export const NETWORK_KEY: NetworkKey = network.key;
export const CHAIN_ID: number = network.chainId;
export const CHAIN = network.viemChain;
export const IS_MAINNET: boolean = network.environment === "mainnet";

// The active network's default stablecoin. Every supported chain has a USDC
// entry (bridged on BNB). Widened to TokenConfig so callers can read the
// `address`/`addressEnvVar` XOR without the per-chain const narrowing.
export const USDC_TOKEN: TokenConfig = network.tokens.USDC;

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
 * Per the CLAUDE.md invariant ("flipping NEXT_PUBLIC_NETWORK must switch the
 * whole app at once"), this deployment serves exactly one network — the one
 * pinned via `NEXT_PUBLIC_NETWORK`. If the caller's mode doesn't match the
 * active network's environment, that's a deployment/config mismatch and we
 * throw loudly instead of silently returning the wrong chain.
 */
export function getNetworkForMode(livemode: boolean): NetworkConfig {
  const wantsMainnet = livemode;
  const isMainnet = NETWORK.environment === "mainnet";
  if (wantsMainnet !== isMainnet) {
    throw new Error(
      `getNetworkForMode(${livemode}): active network '${NETWORK.key}' is ${NETWORK.environment}; ` +
        `livemode='${livemode}' requires a ${wantsMainnet ? "mainnet" : "testnet"} deployment. ` +
        `Set NEXT_PUBLIC_NETWORK accordingly.`,
    );
  }
  return NETWORK;
}
