import type { NetworkConfig, TokenConfig } from "./network-types";
import { NETWORKS, type NetworkKey } from "./network-registry";

/**
 * The concrete type of a single entry in NETWORKS. Preserves the literal
 * `key` field so `getActiveNetwork().key` narrows to NetworkKey (instead of
 * collapsing to `string` via the base NetworkConfig interface).
 */
type ActiveNetwork = (typeof NETWORKS)[NetworkKey];

/**
 * Returns the active network based on NEXT_PUBLIC_NETWORK. Re-reads env on
 * every call so tests and per-request overrides work without module reloads.
 */
export function getActiveNetwork(): ActiveNetwork {
  const key = process.env.NEXT_PUBLIC_NETWORK;
  if (!key) {
    throw new Error(
      `NEXT_PUBLIC_NETWORK is not set. Valid keys: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
  if (!(key in NETWORKS)) {
    throw new Error(
      `NEXT_PUBLIC_NETWORK='${key}' is not a known network. Valid keys: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
  return NETWORKS[key as NetworkKey] as ActiveNetwork;
}

/**
 * Networks in the same environment (testnet/mainnet) as the active one.
 * This is where mainnet/testnet separation is actually enforced — every UI
 * that lists networks MUST call this, not `Object.values(NETWORKS)`.
 */
export function getAvailableNetworks(): NetworkConfig[] {
  const active = getActiveNetwork();
  return Object.values(NETWORKS).filter((n) => n.environment === active.environment);
}

/**
 * Every registered network regardless of environment. Use only when the
 * caller must support multi-mode at runtime (wagmi/AppKit can switch between
 * mainnet and its matching testnet based on session mode).
 */
export function getAllNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS);
}

/**
 * Resolve a token's on-chain address. Canonical address first, else env var.
 * Throws loudly — silent zero-address fallbacks turn into cryptic reverts.
 */
export function resolveTokenAddress(token: TokenConfig): `0x${string}` {
  if (token.address) return token.address;
  if (token.addressEnvVar) {
    const raw = process.env[token.addressEnvVar];
    if (!raw || raw === "0x0000000000000000000000000000000000000000") {
      throw new Error(
        `${token.addressEnvVar} is not set or is the zero address. Token ${token.symbol} cannot be resolved.`,
      );
    }
    return raw as `0x${string}`;
  }
  throw new Error(
    `Token ${token.symbol} has neither an address nor an addressEnvVar. Fix the registry entry in packages/config/src/network-registry.ts.`,
  );
}

export function assertValidNetworkKey(k: string): asserts k is NetworkKey {
  if (!(k in NETWORKS)) {
    throw new Error(`Invalid network key '${k}'. Valid: ${Object.keys(NETWORKS).join(", ")}`);
  }
}

export function assertValidTokenSymbol(network: NetworkConfig, symbol: string): void {
  if (!(symbol in network.tokens)) {
    throw new Error(
      `Token '${symbol}' is not registered on ${network.chainName}. Available: ${Object.keys(network.tokens).join(", ")}`,
    );
  }
}

export function getToken(networkKey: NetworkKey, tokenSymbol: string): TokenConfig {
  if (!(networkKey in NETWORKS)) {
    throw new Error(
      `Unknown network key '${networkKey}'. Valid: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
  const network = NETWORKS[networkKey];
  assertValidTokenSymbol(network, tokenSymbol);
  return (network.tokens as Record<string, TokenConfig>)[tokenSymbol]!;
}

/**
 * Signature schemes the relay route + checkout client currently know how to
 * execute. Flip entries to `true` as the matching app code lands:
 *
 *   - eip2612     — wired today (PaymentVault.createPaymentWithPermit)
 *   - permit2     — PaymentVault path shipped in #55 part 1, relay not yet dispatched
 *   - dai-permit  — contract path pending
 *   - none        — never usable by design
 *
 * UIs that list selectable tokens MUST filter via `isTokenUsable` so they
 * don't show options that would fail at relay time.
 */
const SCHEME_USABLE = {
  eip2612: true,
  // Permit2 one-time payments are wired end-to-end as of the #56 part 2
  // changes. Subscription Permit2 still needs relay-payload wiring, but
  // the product form / checkout picker gate by payment type before this
  // helper sees the token — safe to flip here.
  permit2: true,
  "dai-permit": false,
  none: false,
} as const;

export function isTokenUsable(token: TokenConfig): boolean {
  return SCHEME_USABLE[token.signatureScheme];
}

/**
 * Returns the tokens on a network that can currently be used for checkout.
 * Thin wrapper so call sites don't have to repeat the filter everywhere.
 */
export function getUsableTokens(network: NetworkConfig): TokenConfig[] {
  return Object.values(network.tokens).filter(isTokenUsable);
}
