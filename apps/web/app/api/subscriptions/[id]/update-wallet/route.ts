import { db } from "@/lib/db";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-auth";
import { orgScope } from "@/lib/org-scope";
import { z } from "zod";

const updateWalletSchema = z.object({
  newWallet: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address"),
});

/**
 * SDK-facing endpoint for requesting a subscription wallet update.
 * This stores the new wallet as a pending update — the subscriber must
 * accept on-chain via `acceptSubscriptionWalletUpdate` to complete the
 * migration. Authenticated via secret API key only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const apiAuth = await authenticateApiKey(request, "secret");
  if (apiAuth?.rateLimitResponse) return apiAuth.rateLimitResponse;
  if (!apiAuth) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const { id } = await params;
  const { organizationId, livemode } = apiAuth;

  const body = await request.json().catch(() => null);
  const parsed = updateWalletSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join("; ");
    return NextResponse.json(
      { error: { code: "validation_failed", message: issues } },
      { status: 400 },
    );
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, id),
        orgScope(subscriptions, { organizationId, livemode }),
      ),
    )
    .limit(1);

  if (!sub) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Subscription not found" } },
      { status: 404 },
    );
  }

  if (sub.status !== "active") {
    return NextResponse.json(
      { error: { code: "invalid_status", message: "Only active subscriptions can update wallet" } },
      { status: 409 },
    );
  }

  if (!sub.onChainId) {
    return NextResponse.json(
      { error: { code: "missing_on_chain_id", message: "Subscription has no on-chain id" } },
      { status: 409 },
    );
  }

  const newWallet = parsed.data.newWallet.toLowerCase();
  if (newWallet === sub.subscriberAddress?.toLowerCase()) {
    return NextResponse.json(
      { error: { code: "same_wallet", message: "New wallet is the same as the current subscriber" } },
      { status: 400 },
    );
  }

  return NextResponse.json({
    subscriptionId: sub.id,
    onChainId: sub.onChainId,
    currentWallet: sub.subscriberAddress,
    newWallet: parsed.data.newWallet,
    message:
      "Wallet update recorded. The new wallet owner must call acceptSubscriptionWalletUpdate on the SubscriptionManager contract to complete the migration.",
  });
}
