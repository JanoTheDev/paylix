import {
  resolveTokenAddress,
  type NetworkConfig,
  type NetworkKey,
} from "@paylix/config/networks";
import type { Chain } from "viem";
import { getNetworkForMode } from "./chain";

export interface WebDeployment {
  network: NetworkConfig;
  networkKey: NetworkKey;
  chain: Chain;
  chainId: number;
  rpcUrl: string;
  paymentVault: `0x${string}`;
  subscriptionManager: `0x${string}`;
  usdcAddress: `0x${string}`;
}

/**
 * Server-side env naming, matching `@paylix/config`'s `parseDeployments`:
 * `${NETWORK_KEY_UPPER}_RPC_URL` / `_PAYMENT_VAULT` / `_SUBSCRIPTION_MANAGER`,
 * hyphens replaced by underscores. `base-sepolia` → `BASE_SEPOLIA_*`.
 */
function envPrefix(networkKey: string): string {
  return networkKey.replace(/-/g, "_").toUpperCase();
}

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (!raw) {
    throw new Error(`${key} is required for this mode's deployment`);
  }
  return raw;
}

function requireEnvAddress(key: string): `0x${string}` {
  const raw = requireEnv(key);
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    // Don't echo the value — env contents shouldn't land in logs verbatim.
    throw new Error(`${key} is not a valid Ethereum address`);
  }
  return raw as `0x${string}`;
}

/**
 * Resolve the default stablecoin address for a network.
 *
 * Goes through the registry's canonical-address / `addressEnvVar`
 * indirection so the server reads the same variable the client bundle does.
 * A legacy `${PREFIX}_MOCK_USDC_ADDRESS` is still honoured as a fallback so
 * existing testnet deployments don't break on upgrade.
 */
function resolveUsdcAddress(network: NetworkConfig): `0x${string}` {
  try {
    return resolveTokenAddress(network.tokens.USDC);
  } catch (err) {
    const legacyKey = `${envPrefix(network.key)}_MOCK_USDC_ADDRESS`;
    if (process.env[legacyKey]) {
      console.warn(
        `[deployment] ${legacyKey} is deprecated; set ` +
          `${network.tokens.USDC.addressEnvVar ?? "the registry env var"} instead.`,
      );
      return requireEnvAddress(legacyKey);
    }
    throw err;
  }
}

/**
 * The contract deployment for a given mode.
 *
 * Network selection goes through `lib/chain.ts` (`getNetworkForMode`) — this
 * module must never name `base` / `base-sepolia` / `8453` / `84532` itself.
 * Flipping `NEXT_PUBLIC_NETWORK` has to move the server-side writes at the
 * same time as the client, and `getNetworkForMode` throws loudly when the
 * requested mode doesn't match the deployed network's environment.
 */
export function resolveDeploymentForMode(livemode: boolean): WebDeployment {
  const network = getNetworkForMode(livemode);
  const prefix = envPrefix(network.key);

  return {
    network,
    networkKey: network.key as NetworkKey,
    chain: network.viemChain,
    chainId: network.chainId,
    rpcUrl: requireEnv(`${prefix}_RPC_URL`),
    paymentVault: requireEnvAddress(`${prefix}_PAYMENT_VAULT`),
    subscriptionManager: requireEnvAddress(`${prefix}_SUBSCRIPTION_MANAGER`),
    usdcAddress: resolveUsdcAddress(network),
  };
}
