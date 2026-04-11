/**
 * Thin re-export layer over @paylix/config/networks. Every file that used
 * to hardcode baseSepolia / base / 84532 should import from here.
 *
 * No module-level caching of process.env — each call to getActiveNetwork()
 * re-reads the env. This matches the spec's "explicit over implicit" rule.
 */

import {
  getActiveNetwork,
  resolveTokenAddress,
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
export const USDC_ADDRESS: `0x${string}` = resolveTokenAddress(USDC_TOKEN);
