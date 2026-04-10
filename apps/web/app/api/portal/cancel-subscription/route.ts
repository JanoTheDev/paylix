import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions, customers } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { verifyPortalToken } from "@/lib/portal-tokens";
import { createRelayerClient } from "@/lib/relayer";
import { CONTRACTS, SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";

/**
 * Customer-initiated gasless subscription cancellation. Customer is
 * authenticated via a signed portal token scoped to their customer UUID.
 * Ownership is verified against the DB, then the relayer submits
 * cancelSubscriptionByRelayerForSubscriber. The customer pays no gas.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { subscriptionId, customerId, token } = body as {
    subscriptionId?: string;
    customerId?: string;
    token?: string;
  };

  if (!subscriptionId || !customerId || !token) {
    return NextResponse.json(
      { error: "Missing subscriptionId, customerId, or token" },
      { status: 400 },
    );
  }

  if (!verifyPortalToken(token, customerId)) {
    return NextResponse.json(
      { error: "Invalid or expired portal token" },
      { status: 401 },
    );
  }

  // Look up the subscription and verify ownership
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);

  if (!sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  if (sub.customerId !== customerId) {
    return NextResponse.json({ error: "Not your subscription" }, { status: 403 });
  }

  if (sub.status !== "active" && sub.status !== "past_due") {
    return NextResponse.json(
      { error: "Subscription is not active" },
      { status: 409 },
    );
  }

  if (!sub.onChainId) {
    return NextResponse.json(
      { error: "Subscription has no on-chain id" },
      { status: 409 },
    );
  }

  // Defensive guard against orphaned rows from a previous deploy. See the
  // matching comment in /api/subscriptions/[id]/cancel-gasless/route.ts.
  const currentContract = CONTRACTS.subscriptionManager.toLowerCase();
  if (
    sub.contractAddress &&
    sub.contractAddress.toLowerCase() !== currentContract
  ) {
    return NextResponse.json(
      {
        error:
          "This subscription belongs to a previous contract deployment and can no longer be cancelled via the active SubscriptionManager.",
      },
      { status: 410 },
    );
  }

  // Fetch the customer's wallet address (subscriber address)
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer?.walletAddress) {
    return NextResponse.json(
      { error: "Customer has no wallet address" },
      { status: 409 },
    );
  }

  try {
    const relayer = createRelayerClient();
    const txHash = await relayer.writeContract({
      address: CONTRACTS.subscriptionManager,
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
      { error: message.slice(0, 400) },
      { status: 502 },
    );
  }
}
