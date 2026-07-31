import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions, customers } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import {
  requirePortalCustomer,
  requireOwnedSubscription,
} from "@/lib/portal-auth";
import { readPortalSubscriptionId } from "../_shared-body";
import { createRelayerClient } from "@/lib/relayer";
import { SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";
import { resolveDeploymentForMode } from "@/lib/deployment";

/**
 * Customer-initiated gasless subscription cancellation. Customer is
 * authenticated via a signed portal token scoped to their customer UUID.
 * Ownership is verified against the DB, then the relayer submits
 * cancelSubscriptionByRelayerForSubscriber. The customer pays no gas.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const portal = await requirePortalCustomer(request, body);
  if (!portal.ok) return portal.response;

  // Ownership is enforced in SQL, so a mismatch can't slip past a forgotten
  // JS comparison, and "exists but isn't yours" answers 404 rather than 403.
  const subscriptionId = readPortalSubscriptionId(body);
  const owned = await requireOwnedSubscription(portal.customerId, subscriptionId);
  if (!owned.ok) return owned.response;
  const sub = owned.subscription;

  if (sub.status !== "active" && sub.status !== "past_due") {
    return NextResponse.json(
      { error: { code: "invalid_status", message: "Subscription is not active" } },
      { status: 409 },
    );
  }

  if (!sub.onChainId) {
    return NextResponse.json(
      { error: { code: "missing_on_chain_id", message: "Subscription has no on-chain id" } },
      { status: 409 },
    );
  }

  // Route to whichever SubscriptionManager owns this subscription. Falls
  // back to the mode-resolved deployment address for subs created before
  // sub.contractAddress was always populated. See spec §Option Z.
  const deployment = resolveDeploymentForMode(sub.livemode);
  const contractAddress = (sub.contractAddress ||
    deployment.subscriptionManager) as `0x${string}`;

  // Fetch the customer's wallet address (subscriber address)
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, portal.customerId))
    .limit(1);

  if (!customer?.walletAddress) {
    return NextResponse.json(
      { error: { code: "missing_wallet", message: "Customer has no wallet address" } },
      { status: 409 },
    );
  }

  try {
    const relayer = createRelayerClient(deployment);
    const txHash = await relayer.writeContract({
      address: contractAddress,
      abi: SUBSCRIPTION_MANAGER_ABI,
      functionName: "cancelSubscriptionByRelayerForSubscriber",
      args: [BigInt(sub.onChainId), customer.walletAddress as `0x${string}`],
    });

    // Wait for the tx to actually mine so on-chain state is settled
    // before returning. ~2-5s on Base Sepolia.
    await relayer.waitForTransactionReceipt({ hash: txHash });

    // Optimistically update the DB so the portal shows "cancelled"
    // immediately after the client refreshes. Indexer will later re-process
    // the SubscriptionCancelled event (idempotent).
    await db
      .update(subscriptions)
      .set({ status: "cancelled" })
      .where(eq(subscriptions.id, subscriptionId));

    return NextResponse.json({ txHash });
  } catch (err) {
    console.error("[PortalCancel] submit failed:", err);
    const message = err instanceof Error ? err.message : "Cancel failed";
    return NextResponse.json(
      { error: { code: "cancel_failed", message: message.slice(0, 400) } },
      { status: 502 },
    );
  }
}
