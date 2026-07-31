import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkoutSessions, products } from "@paylix/db/schema";
import { checkExistingSubscription } from "../relay/dedup";
import { normalizeEmail } from "@/lib/email-normalize";
import { checkWalletActivity } from "@/lib/wallet-activity";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { clientIpKey } from "../../../_shared/client-ip";

/**
 * Whether the buyer at this checkout can still take the free trial.
 *
 * Unauthenticated by necessity (public checkout page), so two things are
 * deliberately tight:
 *
 *  - **Rate limited per IP and per session.** Each call fires two RPC reads
 *    via `checkWalletActivity`, so without a limit this doubles as an
 *    unmetered proxy against the configured node.
 *  - **The email is read from the session, not the query string.** An
 *    attacker-supplied `?email=` turned the `eligible` flag into a
 *    membership check against the merchant's whole customer list — the
 *    trial dedup matches across *all* subscription statuses, including
 *    cancelled.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const buyer = url.searchParams.get("buyer");

  const ip = clientIpKey(request);
  const ipLimit = await checkRateLimitAsync(`trial-eligibility:${ip}`, 20, 60_000);
  if (!ipLimit.ok) {
    return rateLimited(ipLimit.retryAfterMs);
  }
  const sessionLimit = await checkRateLimitAsync(
    `trial-eligibility-session:${id}`,
    20,
    60_000,
  );
  if (!sessionLimit.ok) {
    return rateLimited(sessionLimit.retryAfterMs);
  }

  if (!buyer || !/^0x[0-9a-fA-F]{40}$/.test(buyer)) {
    return NextResponse.json(
      { error: { code: "invalid_buyer" } },
      { status: 400 },
    );
  }

  const [session] = await db
    .select({
      organizationId: checkoutSessions.organizationId,
      livemode: checkoutSessions.livemode,
      productId: checkoutSessions.productId,
      customerId: checkoutSessions.customerId,
      buyerEmail: checkoutSessions.buyerEmail,
      type: checkoutSessions.type,
      networkKey: checkoutSessions.networkKey,
      tokenSymbol: checkoutSessions.tokenSymbol,
      trialDays: products.trialDays,
      trialMinutes: products.trialMinutes,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .where(eq(checkoutSessions.id, id));

  if (!session) {
    return NextResponse.json(
      { error: { code: "session_not_found" } },
      { status: 404 },
    );
  }

  // Only the email already stored on the session counts. Anything in the
  // query string is ignored.
  const storedEmail = session.buyerEmail?.trim();
  const normalizedEmail = storedEmail ? normalizeEmail(storedEmail) : null;

  const trialDuration =
    (session.trialMinutes ?? 0) > 0
      ? (session.trialMinutes ?? 0) * 60
      : (session.trialDays ?? 0) * 24 * 60 * 60;
  const productHasTrial = session.type === "subscription" && trialDuration > 0;

  if (!productHasTrial) {
    return NextResponse.json({ eligible: false, productHasTrial: false });
  }

  if (session.networkKey && session.tokenSymbol) {
    const wallet = await checkWalletActivity({
      address: buyer as `0x${string}`,
      networkKey: session.networkKey,
      tokenSymbol: session.tokenSymbol,
      rpcUrl: resolveDeploymentForMode(session.livemode).rpcUrl,
    });
    if (!wallet.active) {
      return NextResponse.json({
        eligible: false,
        productHasTrial: true,
        reason: "wallet_inactive",
      });
    }
  }

  const dedup = await checkExistingSubscription({
    organizationId: session.organizationId,
    livemode: session.livemode,
    productId: session.productId,
    buyerWallet: buyer,
    customerIdentifier: session.customerId ?? null,
    buyerEmail: normalizedEmail,
    intent: "trial",
  });

  return NextResponse.json({
    eligible: !dedup.exists,
    productHasTrial: true,
  });
}

function rateLimited(retryAfterMs: number | undefined) {
  const retryAfter = String(Math.ceil((retryAfterMs ?? 0) / 1000));
  return NextResponse.json(
    {
      error: {
        code: "rate_limited",
        message: `Too many requests. Retry in ${retryAfter}s`,
      },
    },
    { status: 429, headers: { "Retry-After": retryAfter } },
  );
}
