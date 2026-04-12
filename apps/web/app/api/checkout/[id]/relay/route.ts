import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import { db } from "@/lib/db";
import { checkoutSessions, products, subscriptions, customers } from "@paylix/db/schema";
import { createRelayerClient } from "@/lib/relayer";
import {
  CONTRACTS,
  PAYMENT_VAULT_ABI,
  SUBSCRIPTION_MANAGER_ABI,
} from "@/lib/contracts";
import { intervalToSeconds } from "@/lib/billing-intervals";
import {
  parseRelayBody,
  validateDeadline,
  validateSessionForRelay,
  type ValidationError,
} from "./validation";
import { acquireRelayLock, releaseRelayLock } from "./lock";
import { checkExistingSubscription } from "./dedup";
import { checkRateLimit } from "@/lib/rate-limit";
import { signPortalToken } from "@/lib/portal-tokens";

function errorResponse(err: ValidationError, status = 400) {
  return NextResponse.json({ error: err }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  // Rate limit: 10 relay attempts per minute per source IP.
  // Per-session dedup is handled by the relay_in_flight_at lock below.
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit(`relay:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: {
          code: "rate_limited",
          message: `Too many requests. Retry in ${Math.ceil(
            (rl.retryAfterMs ?? 0) / 1000,
          )}s`,
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)),
        },
      },
    );
  }

  // 1. Parse + validate request body
  const body = await request.json().catch(() => ({}));
  const parsed = parseRelayBody(body);
  if (!parsed.ok) return errorResponse(parsed.error);
  const { buyer, deadline, v, r, s, permitValue, intentSignature } = parsed.value;
  // (networkKey and tokenSymbol also in parsed.value, validated below after session load)

  // 3. Load session + product
  const [session] = await db
    .select({
      id: checkoutSessions.id,
      status: checkoutSessions.status,
      expiresAt: checkoutSessions.expiresAt,
      paymentId: checkoutSessions.paymentId,
      subscriptionId: checkoutSessions.subscriptionId,
      type: checkoutSessions.type,
      amount: checkoutSessions.amount,
      networkKey: checkoutSessions.networkKey,
      tokenSymbol: checkoutSessions.tokenSymbol,
      merchantWallet: checkoutSessions.merchantWallet,
      productId: checkoutSessions.productId,
      organizationId: checkoutSessions.organizationId,
      customerId: checkoutSessions.customerId,
      buyerCountry: checkoutSessions.buyerCountry,
      buyerTaxId: checkoutSessions.buyerTaxId,
      buyerFirstName: checkoutSessions.buyerFirstName,
      buyerLastName: checkoutSessions.buyerLastName,
      buyerEmail: checkoutSessions.buyerEmail,
      buyerPhone: checkoutSessions.buyerPhone,
      billingInterval: products.billingInterval,
      trialDays: products.trialDays,
      trialMinutes: products.trialMinutes,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .where(eq(checkoutSessions.id, sessionId));

  const sessionCheck = validateSessionForRelay(
    session
      ? {
          status: session.status as string,
          expiresAt: new Date(session.expiresAt),
          paymentId: session.paymentId,
          subscriptionId: session.subscriptionId,
        }
      : null,
  );
  if (!sessionCheck.ok) {
    const status = sessionCheck.error.code === "session_not_found" ? 404 : 409;
    return errorResponse(sessionCheck.error, status);
  }

  // 4. Compute on-chain args early (used in both trial and relay branches)
  const tokenAmount = session.amount as bigint;
  const productIdBytes = keccak256(stringToBytes(session.productId));
  const customerIdBytes = keccak256(stringToBytes(session.id));
  const isSubscription = session.type === "subscription";

  // Guard: session must have a locked currency before it can be relayed
  if (!session.networkKey || !session.tokenSymbol) {
    return NextResponse.json(
      {
        error: {
          code: "currency_not_selected",
          message: "Buyer must pick a currency before paying this session.",
        },
      },
      { status: 409 },
    );
  }

  // Verify the request's networkKey/tokenSymbol matches the session
  if (parsed.value.networkKey !== session.networkKey) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_body",
          message: "networkKey does not match the session",
        },
      },
      { status: 400 },
    );
  }
  if (parsed.value.tokenSymbol !== session.tokenSymbol) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_body",
          message: "tokenSymbol does not match the session",
        },
      },
      { status: 400 },
    );
  }

  // 5. Trial subscription branch
  const trialDays = session.trialDays ?? 0;
  const trialMinutes = session.trialMinutes ?? 0;
  const trialDurationSeconds =
    trialMinutes > 0
      ? trialMinutes * 60
      : trialDays * 24 * 60 * 60;
  const isTrial = isSubscription && trialDurationSeconds > 0;

  // Permit deadline window: trial duration + 48h grace + 1h slop
  const maxDeadlineWindowSeconds = isTrial
    ? trialDurationSeconds + 48 * 60 * 60 + 60 * 60
    : 60 * 60;
  const deadlineCheck = validateDeadline(deadline, maxDeadlineWindowSeconds);
  if (!deadlineCheck.ok) return errorResponse(deadlineCheck.error);

  let runTrialBranch = isTrial;
  if (runTrialBranch) {
    const dedup = await checkExistingSubscription({
      organizationId: session.organizationId,
      productId: session.productId,
      buyerWallet: buyer,
      customerIdentifier: session.customerId ?? null,
      intent: "trial",
    });

    if (dedup.exists) {
      // Customer has already used the trial on this product.
      // Fall through to the regular paid subscription path — they can still
      // subscribe, just without the free period.
      console.log(
        `[Relay] trial dedup hit for buyer=${buyer} product=${session.productId}; falling back to paid subscription`,
      );
      runTrialBranch = false;
    }
  }

  if (runTrialBranch) {
    const intervalSeconds = intervalToSeconds(session.billingInterval);
    if (intervalSeconds <= 0) {
      return NextResponse.json(
        { error: { code: "invalid_interval", message: "Product has no valid billing interval" } },
        { status: 400 },
      );
    }

    const trialEndsAt = new Date(Date.now() + trialDurationSeconds * 1000);

    const customerIdentifier = session.customerId ?? `anon_${buyer}`;
    let [customer] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, session.organizationId),
          eq(customers.customerId, customerIdentifier),
        ),
      );
    if (!customer) {
      const [created] = await db
        .insert(customers)
        .values({
          organizationId: session.organizationId,
          customerId: customerIdentifier,
          walletAddress: buyer,
          country: session.buyerCountry ?? null,
          taxId: session.buyerTaxId ?? null,
          firstName: session.buyerFirstName ?? null,
          lastName: session.buyerLastName ?? null,
          email: session.buyerEmail ?? null,
          phone: session.buyerPhone ?? null,
        })
        .returning();
      customer = created;
    } else {
      const customerPatch: Record<string, string | null> = {};
      if (!customer.walletAddress) customerPatch.walletAddress = buyer;
      if (!customer.firstName && session.buyerFirstName) customerPatch.firstName = session.buyerFirstName;
      if (!customer.lastName && session.buyerLastName) customerPatch.lastName = session.buyerLastName;
      if (!customer.email && session.buyerEmail) customerPatch.email = session.buyerEmail;
      if (!customer.phone && session.buyerPhone) customerPatch.phone = session.buyerPhone;
      if (!customer.country && session.buyerCountry) customerPatch.country = session.buyerCountry;
      if (!customer.taxId && session.buyerTaxId) customerPatch.taxId = session.buyerTaxId;
      if (Object.keys(customerPatch).length > 0) {
        await db.update(customers).set(customerPatch).where(eq(customers.id, customer.id));
        customer = { ...customer, ...customerPatch } as typeof customer;
      }
    }

    const pendingPermitSignature = {
      permit: {
        value: permitValue.toString(),
        deadline: Number(deadline),
        v: Number(v),
        r,
        s,
      },
      intent: {
        merchantId: session.merchantWallet,
        amount: tokenAmount.toString(),
        interval: Number(intervalSeconds),
        nonce: session.id,
        deadline: Number(deadline),
        signature: intentSignature,
        productIdBytes,
        customerIdBytes,
      },
      priceSnapshot: {
        networkKey: session.networkKey!,
        tokenSymbol: session.tokenSymbol!,
        amount: tokenAmount.toString(),
      },
    };

    const [newSub] = await db
      .insert(subscriptions)
      .values({
        productId: session.productId,
        organizationId: session.organizationId,
        customerId: customer.id,
        subscriberAddress: buyer,
        contractAddress: CONTRACTS.subscriptionManager.toLowerCase(),
        networkKey: session.networkKey!,
        tokenSymbol: session.tokenSymbol!,
        status: "trialing",
        trialEndsAt,
        pendingPermitSignature,
        intervalSeconds: Number(intervalSeconds),
        metadata: {},
      })
      .returning();

    await db
      .update(checkoutSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        subscriptionId: newSub.id,
      })
      .where(eq(checkoutSessions.id, session.id));

    // TODO: fire subscription.trial_started webhook once apps/web webhook dispatcher is factored out

    return NextResponse.json({
      trial: true,
      subscriptionId: newSub.id,
      trialEndsAt: trialEndsAt.toISOString(),
      customerUuid: customer.id,
      portalToken: signPortalToken(customer.id),
    });
  }

  if (isSubscription) {
    const dedup = await checkExistingSubscription({
      organizationId: session.organizationId,
      productId: session.productId,
      buyerWallet: buyer,
      customerIdentifier: session.customerId ?? null,
      intent: "subscription",
    });
    if (dedup.exists) {
      return NextResponse.json(
        {
          error: {
            code: "duplicate_subscription",
            message:
              "This customer already has an active or trialing subscription for this product.",
          },
        },
        { status: 409 },
      );
    }
  }

  // Acquire an atomic lock on the session so two concurrent relay attempts
  // can't both reach the contract call. The lock is released on terminal
  // failure (below); on success the indexer's session-completed update
  // supersedes it.
  const locked = await acquireRelayLock(db, sessionId);
  if (!locked) {
    return NextResponse.json(
      { error: { code: "session_already_relayed" } },
      { status: 409 },
    );
  }

  // 6. Submit the relayed transaction
  // session.amount is now stored in native token units (bigint), no
  // conversion needed. The old cents × 10_000 math is gone — amounts are
  // whatever the merchant set in the product_prices entry for this
  // (networkKey, tokenSymbol) pair.
  const relayer = createRelayerClient();
  let txHash: `0x${string}`;

  try {
    if (isSubscription) {
      const intervalSeconds = BigInt(intervalToSeconds(session.billingInterval));
      if (intervalSeconds <= BigInt(0)) {
        return NextResponse.json(
          { error: { code: "invalid_interval", message: "Product has no valid billing interval" } },
          { status: 400 },
        );
      }
      txHash = await relayer.writeContract({
        address: CONTRACTS.subscriptionManager,
        abi: SUBSCRIPTION_MANAGER_ABI,
        functionName: "createSubscriptionWithPermit",
        args: [
          {
            token: CONTRACTS.usdc,
            buyer,
            merchant: session.merchantWallet as `0x${string}`,
            amount: tokenAmount,
            interval: intervalSeconds,
            productId: productIdBytes,
            customerId: customerIdBytes,
            permitValue,
            deadline,
            v,
            r,
            s,
          },
          intentSignature,
        ],
      });
    } else {
      txHash = await relayer.writeContract({
        address: CONTRACTS.paymentVault,
        abi: PAYMENT_VAULT_ABI,
        functionName: "createPaymentWithPermit",
        args: [
          CONTRACTS.usdc,
          buyer,
          session.merchantWallet as `0x${string}`,
          tokenAmount,
          productIdBytes,
          customerIdBytes,
          { deadline, v, r, s },
          intentSignature,
        ],
      });
    }
  } catch (err) {
    // Release the lock so the user can retry
    await releaseRelayLock(db, sessionId).catch(() => {});
    console.error("[Relay] submit failed:", err);
    const message = err instanceof Error ? err.message : "Relay failed";
    return NextResponse.json(
      { error: { code: "relay_failed", message: message.slice(0, 400) } },
      { status: 502 },
    );
  }

  return NextResponse.json({ txHash });
}
