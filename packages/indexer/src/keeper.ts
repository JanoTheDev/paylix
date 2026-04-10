import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { createDb } from "@paylix/db/client";
import { subscriptions } from "@paylix/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { config } from "./config";

const chargeSubscriptionAbi = [{
  name: "chargeSubscription",
  type: "function",
  inputs: [{ name: "subscriptionId", type: "uint256" }],
  outputs: [],
  stateMutability: "nonpayable",
}] as const;

function getChain() {
  return config.network === "base" ? base : baseSepolia;
}

export async function runKeeper() {
  console.log("[Keeper] Running subscription charge check...");

  const db = createDb(config.databaseUrl);
  const chain = getChain();
  const account = privateKeyToAccount(config.keeperPrivateKey);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const now = new Date();

  const dueSubscriptions = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "active"),
        lte(subscriptions.nextChargeDate, now)
      )
    );

  console.log(`[Keeper] Found ${dueSubscriptions.length} subscriptions due for charge`);

  for (const sub of dueSubscriptions) {
    if (!sub.onChainId) {
      console.warn(`[Keeper] Subscription ${sub.id} has no onChainId, skipping`);
      continue;
    }

    try {
      console.log(`[Keeper] Charging subscription ${sub.id} (onChainId: ${sub.onChainId})`);

      const txHash = await walletClient.writeContract({
        address: config.subscriptionManagerAddress,
        abi: chargeSubscriptionAbi,
        functionName: "chargeSubscription",
        args: [BigInt(sub.onChainId)],
      });

      console.log(`[Keeper] Transaction sent: ${txHash}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      console.log(`[Keeper] Transaction ${receipt.status}: ${txHash} (block ${receipt.blockNumber})`);
    } catch (error) {
      console.error(`[Keeper] Failed to charge subscription ${sub.id}:`, error);
    }
  }

  console.log("[Keeper] Charge check complete.");
}
