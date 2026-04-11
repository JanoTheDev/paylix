import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createDb } from "@paylix/db/client";
import { subscriptions } from "@paylix/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { config } from "./config";

const DEFAULT_INTERVAL_SECONDS = 30 * 24 * 60 * 60; // 30 days fallback

const chargeSubscriptionAbi = [{
  name: "chargeSubscription",
  type: "function",
  inputs: [{ name: "subscriptionId", type: "uint256" }],
  outputs: [],
  stateMutability: "nonpayable",
}] as const;

function getChain() {
  return config.chain;
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

  const currentContract = config.subscriptionManagerAddress.toLowerCase();
  const dueSubscriptions = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "active"),
        eq(subscriptions.contractAddress, currentContract),
        lte(subscriptions.nextChargeDate, now)
      )
    );

  console.log(`[Keeper] Found ${dueSubscriptions.length} subscriptions due for charge`);

  for (const sub of dueSubscriptions) {
    if (!sub.onChainId) {
      console.warn(`[Keeper] Subscription ${sub.id} has no onChainId, skipping`);
      continue;
    }

    // Optimistically bump nextChargeDate BEFORE sending the tx to prevent the
    // next keeper tick from reselecting this subscription if the current
    // attempt is still in-flight. Roll back on failure.
    const originalNextChargeDate = sub.nextChargeDate;
    const intervalSeconds =
      (sub.intervalSeconds && sub.intervalSeconds > 0
        ? sub.intervalSeconds
        : null) ?? DEFAULT_INTERVAL_SECONDS;
    const intervalMs = intervalSeconds * 1000;
    const baseTime = originalNextChargeDate
      ? originalNextChargeDate.getTime()
      : now.getTime();
    const tentativeNext = new Date(baseTime + intervalMs);

    try {
      await db
        .update(subscriptions)
        .set({ nextChargeDate: tentativeNext })
        .where(eq(subscriptions.id, sub.id));
    } catch (err) {
      console.error(
        `[Keeper] Failed to bump nextChargeDate for ${sub.id}, skipping:`,
        err
      );
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
      // Roll back the optimistic bump so we retry next tick.
      try {
        await db
          .update(subscriptions)
          .set({ nextChargeDate: originalNextChargeDate })
          .where(eq(subscriptions.id, sub.id));
      } catch (rollbackErr) {
        console.error(
          `[Keeper] Failed to roll back nextChargeDate for ${sub.id}:`,
          rollbackErr
        );
      }
    }
  }

  console.log("[Keeper] Charge check complete.");
}
