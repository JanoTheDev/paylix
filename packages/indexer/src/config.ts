import { getActiveNetwork } from "@paylix/config/networks";

const network = getActiveNetwork();

export const config = {
  networkKey: network.key,
  chain: network.viemChain,
  environment: network.environment,
  rpcUrl: process.env.RPC_URL!,
  databaseUrl: process.env.DATABASE_URL!,
  paymentVaultAddress: process.env.PAYMENT_VAULT_ADDRESS! as `0x${string}`,
  subscriptionManagerAddress: process.env.SUBSCRIPTION_MANAGER_ADDRESS! as `0x${string}`,
  keeperPrivateKey: process.env.KEEPER_PRIVATE_KEY! as `0x${string}`,
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined,
  keeperIntervalMinutes: parseInt(process.env.KEEPER_INTERVAL_MINUTES || "60", 10),
};
