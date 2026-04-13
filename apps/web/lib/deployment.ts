import { NETWORKS, type NetworkConfig } from "@paylix/config/networks";
import type { Chain } from "viem";

export interface WebDeployment {
  network: NetworkConfig;
  chain: Chain;
  chainId: number;
  rpcUrl: string;
  paymentVault: `0x${string}`;
  subscriptionManager: `0x${string}`;
  usdcAddress: `0x${string}`;
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
    throw new Error(`${key} is not a valid Ethereum address: ${raw}`);
  }
  return raw as `0x${string}`;
}

export function resolveDeploymentForMode(livemode: boolean): WebDeployment {
  if (livemode) {
    const network = NETWORKS["base"];
    const canonicalUsdc = network.tokens.USDC.address;
    if (!canonicalUsdc) {
      throw new Error("base mainnet USDC has no canonical address in registry");
    }
    return {
      network,
      chain: network.viemChain,
      chainId: network.chainId,
      rpcUrl: requireEnv("BASE_RPC_URL"),
      paymentVault: requireEnvAddress("BASE_PAYMENT_VAULT"),
      subscriptionManager: requireEnvAddress("BASE_SUBSCRIPTION_MANAGER"),
      usdcAddress: canonicalUsdc,
    };
  }

  const network = NETWORKS["base-sepolia"];
  return {
    network,
    chain: network.viemChain,
    chainId: network.chainId,
    rpcUrl: requireEnv("BASE_SEPOLIA_RPC_URL"),
    paymentVault: requireEnvAddress("BASE_SEPOLIA_PAYMENT_VAULT"),
    subscriptionManager: requireEnvAddress("BASE_SEPOLIA_SUBSCRIPTION_MANAGER"),
    usdcAddress: requireEnvAddress("BASE_SEPOLIA_MOCK_USDC_ADDRESS"),
  };
}
