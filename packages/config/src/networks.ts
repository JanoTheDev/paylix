/**
 * Public entry point for the network/token registry.
 *
 * Everything importable from "@paylix/config/networks" is re-exported from
 * here. The implementation is split across three files to keep each small:
 *   - network-types.ts     — shared type definitions
 *   - network-registry.ts  — data (one entry per supported chain)
 *   - network-helpers.ts   — functions (getActiveNetwork, resolveTokenAddress, etc.)
 *
 * Adding a new network is a single entry in network-registry.ts — the
 * NetworkKey union derives from `keyof typeof NETWORKS` automatically.
 */

export type { Environment, SignatureScheme, TokenConfig, NetworkConfig } from "./network-types";
export { NETWORKS, type NetworkKey } from "./network-registry";
export {
  getActiveNetwork,
  getAvailableNetworks,
  getAllNetworks,
  resolveTokenAddress,
  assertValidNetworkKey,
  assertValidTokenSymbol,
  getToken,
  isTokenUsable,
  getUsableTokens,
} from "./network-helpers";
