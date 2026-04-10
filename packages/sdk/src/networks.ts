import type { NetworkConfig } from "./types";

export const NETWORKS: Record<string, NetworkConfig> = {
  base: {
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    paymentVaultAddress: "0x0000000000000000000000000000000000000000",
    subscriptionManagerAddress: "0x0000000000000000000000000000000000000000",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    basescanUrl: "https://basescan.org",
  },
  "base-sepolia": {
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    paymentVaultAddress: "0x0000000000000000000000000000000000000000",
    subscriptionManagerAddress: "0x0000000000000000000000000000000000000000",
    usdcAddress: "0x0000000000000000000000000000000000000000",
    basescanUrl: "https://sepolia.basescan.org",
  },
};
