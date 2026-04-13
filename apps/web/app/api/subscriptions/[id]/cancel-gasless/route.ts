import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { subscriptions, user as userTable } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { createRelayerClient } from "@/lib/relayer";
import { SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { authenticateApiKey } from "@/lib/api-auth";
import { requireActiveOrg } from "@/lib/require-active-org";
import { getDashboardLivemode } from "@/lib/request-mode";
import { orgScope } from "@/lib/org-scope";
import { resolvePayoutWallet } from "@/lib/payout-wallets";
import type { NetworkKey } from "@paylix/config/networks";

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
  let merchantOrgId: string | null = null;
  let merchantUserId: string | null = null;
  let merchantLivemode = false;

  const apiAuth = await authenticateApiKey(request, "secret");
  if (apiAuth?.rateLimitResponse) return apiAuth.rateLimitResponse;
  if (apiAuth) {
    merchantOrgId = apiAuth.organizationId;
    merchantLivemode = apiAuth.livemode;
  } else {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session) {
      try {
        merchantOrgId = requireActiveOrg(session);
        merchantUserId = session.user.id;
        merchantLivemode = await getDashboardLivemode();
      } catch {
        return NextResponse.json({ error: { code: "no_active_org", message: "No active team selected" } }, { status: 400 });
      }
    }
  }

  if (!merchantOrgId) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
  }

  const { id } = await params;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, id),
        orgScope(subscriptions, { organizationId: merchantOrgId, livemode: merchantLivemode }),
      ),
    )
    .limit(1);

  if (!sub) {
    return NextResponse.json({ error: { code: "not_found", message: "Subscription not found" } }, { status: 404 });
  }

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
  const deployment = resolveDeploymentForMode(merchantLivemode);
  const contractAddress = (sub.contractAddress ||
    deployment.subscriptionManager) as `0x${string}`;

  // Resolve merchant wallet: prefer payout-wallet config, fall back to user row.
  let resolvedWallet: `0x${string}`;
  try {
    resolvedWallet = await resolvePayoutWallet(
      merchantOrgId,
      sub.networkKey as NetworkKey,
      merchantUserId ?? undefined,
    );
  } catch {
    if (!merchantUserId) {
      return NextResponse.json(
        { error: { code: "missing_wallet", message: "Merchant wallet not configured in settings" } },
        { status: 400 },
      );
    }
    const [merchantRow] = await db
      .select({ walletAddress: userTable.walletAddress })
      .from(userTable)
      .where(eq(userTable.id, merchantUserId))
      .limit(1);

    if (!merchantRow?.walletAddress) {
      return NextResponse.json(
        { error: { code: "missing_wallet", message: "Merchant wallet not configured in settings" } },
        { status: 400 },
      );
    }
    resolvedWallet = merchantRow.walletAddress as `0x${string}`;
  }

  try {
    const relayer = createRelayerClient(deployment);
    const txHash = await relayer.writeContract({
      address: contractAddress,
      abi: SUBSCRIPTION_MANAGER_ABI,
      functionName: "cancelSubscriptionByRelayerForMerchant",
      args: [BigInt(sub.onChainId), resolvedWallet],
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
      { error: { code: "cancel_failed", message: message.slice(0, 400) } },
      { status: 502 },
    );
  }
}
