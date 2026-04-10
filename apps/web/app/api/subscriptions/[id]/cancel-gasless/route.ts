import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { subscriptions, user as userTable } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { createRelayerClient } from "@/lib/relayer";
import { CONTRACTS, SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";

/**
 * Merchant-initiated gasless subscription cancellation. Merchant is
 * authenticated via better-auth, ownership is verified against the DB,
 * then the relayer submits cancelSubscriptionByRelayerForMerchant on the
 * SubscriptionManager contract. The merchant never signs anything and
 * pays no gas.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
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
        eq(subscriptions.userId, session.user.id),
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

  // Defensive guard against orphaned rows from a previous deploy. If the
  // subscription was created on a SubscriptionManager that's no longer the
  // active contract (contract_address mismatches .env), the cancel call
  // would revert with a cryptic "Not the merchant" because the contract
  // would read a zero-value struct at that onChainId. Fail fast here with
  // a clear error instead.
  const currentContract = CONTRACTS.subscriptionManager.toLowerCase();
  if (
    sub.contractAddress &&
    sub.contractAddress.toLowerCase() !== currentContract
  ) {
    return NextResponse.json(
      {
        error:
          "This subscription belongs to a previous contract deployment and can no longer be cancelled via the active SubscriptionManager. Please wipe stale test data.",
      },
      { status: 410 },
    );
  }

  // Fetch the merchant's wallet address from the user table. The better-auth
  // session.user object doesn't include the walletAddress column by default,
  // so we query it directly.
  const [merchantRow] = await db
    .select({ walletAddress: userTable.walletAddress })
    .from(userTable)
    .where(eq(userTable.id, session.user.id))
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
      address: CONTRACTS.subscriptionManager,
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
