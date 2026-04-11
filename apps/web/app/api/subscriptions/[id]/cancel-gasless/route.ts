import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { subscriptions, user as userTable } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { createRelayerClient } from "@/lib/relayer";
import { CONTRACTS, SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";
import { authenticateApiKey } from "@/lib/api-auth";

/**
 * Merchant-initiated gasless subscription cancellation. Merchant is
 * authenticated either via a better-auth session (dashboard) or a secret
 * API key (SDK). Ownership is verified against the DB, then the relayer
 * submits cancelSubscriptionByRelayerForMerchant on the SubscriptionManager
 * contract. The merchant never signs anything and pays no gas.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let merchantUserId: string | null = null;

  const apiAuth = await authenticateApiKey(request, "secret");
  if (apiAuth) {
    merchantUserId = apiAuth.user.id;
  } else {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session) merchantUserId = session.user.id;
  }

  if (!merchantUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify the merchant owns this subscription
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, id),
        eq(subscriptions.userId, merchantUserId),
      ),
    )
    .limit(1);

  if (!sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  // Route to whichever SubscriptionManager owns this subscription. Falls
  // back to the active env address for subs created before sub.contractAddress
  // was always populated. See spec §Option Z.
  const contractAddress = (sub.contractAddress ||
    CONTRACTS.subscriptionManager) as `0x${string}`;

  // Fetch the merchant's wallet address from the user table. The better-auth
  // session.user object doesn't include the walletAddress column by default,
  // so we query it directly.
  const [merchantRow] = await db
    .select({ walletAddress: userTable.walletAddress })
    .from(userTable)
    .where(eq(userTable.id, merchantUserId))
    .limit(1);

  if (!merchantRow?.walletAddress) {
    return NextResponse.json(
      { error: "Merchant wallet not configured in settings" },
      { status: 400 },
    );
  }

  try {
    const relayer = createRelayerClient();
    const txHash = await relayer.writeContract({
      address: contractAddress, // was: CONTRACTS.subscriptionManager
      abi: SUBSCRIPTION_MANAGER_ABI,
      functionName: "cancelSubscriptionByRelayerForMerchant",
      args: [BigInt(sub.onChainId), merchantRow.walletAddress as `0x${string}`],
    });

    // Wait for the tx to actually mine so we know the on-chain state is
    // settled before we return. On Base Sepolia this is ~2-5s.
    await relayer.waitForTransactionReceipt({ hash: txHash });

    // Optimistically update the DB so the dashboard shows "cancelled"
    // immediately after router.refresh(). The indexer will re-process the
    // SubscriptionCancelled event a moment later and set the same value
    // (handleSubscriptionCancelled is idempotent), so this is safe.
    await db
      .update(subscriptions)
      .set({ status: "cancelled" })
      .where(eq(subscriptions.id, id));

    return NextResponse.json({ txHash });
  } catch (err) {
    console.error("[CancelGasless] submit failed:", err);
    const message = err instanceof Error ? err.message : "Cancel failed";
    return NextResponse.json(
      { error: message.slice(0, 400) },
      { status: 502 },
    );
  }
}
