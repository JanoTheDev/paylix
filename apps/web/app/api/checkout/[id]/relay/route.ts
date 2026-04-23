import { NextResponse } from "next/server";
import { eq, and, or, isNull } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import { db } from "@/lib/db";
import {
  checkoutSessions,
  products,
  subscriptions,
  customers,
  coupons,
  couponRedemptions,
} from "@paylix/db/schema";
import { sql } from "drizzle-orm";
import { createRelayerClient } from "@/lib/relayer";
import {
  PAYMENT_VAULT_ABI,
  SUBSCRIPTION_MANAGER_ABI,
} from "@/lib/contracts";
import { resolveDeploymentForMode } from "@/lib/deployment";
import {
  getToken,
  resolveTokenAddress,
  type NetworkKey,
} from "@paylix/config/networks";
import { intervalToSeconds } from "@/lib/billing-intervals";
import {
  parseRelayBody,
  validateDeadline,
  validateSessionForRelay,
  type ValidationError,
} from "./validation";
import { acquireRelayLock, releaseRelayLock } from "./lock";
import { checkExistingSubscription } from "./dedup";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { signPortalToken } from "@/lib/portal-tokens";
import { normalizeEmail, isDisposableEmail } from "@/lib/email-normalize";
import { checkWalletActivity } from "@/lib/wallet-activity";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";
import { findBlocklistMatch, BLOCKLIST_MESSAGE } from "@/lib/blocklist";
import { loadOrgBlocklist } from "@/lib/blocklist-load";

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("execution reverted") ||
        message.includes("insufficient funds") ||
        message.includes("nonce too low")
      ) {
        throw err;
      }
      if (attempt < maxAttempts - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`[Relay] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

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
  const rl = await checkRateLimitAsync(`relay:${ip}`, 10, 60_000);
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
  const {
    buyer,
    deadline,
    v,
    r,
    s,
    permitValue,
    permit2Nonce,
    permit2Signature,
    intentSignature,
  } = parsed.value;
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
      livemode: checkoutSessions.livemode,
      metadata: checkoutSessions.metadata,
      appliedCouponId: checkoutSessions.appliedCouponId,
      discountCents: checkoutSessions.discountCents,
      subtotalAmount: checkoutSessions.subtotalAmount,
      quantity: checkoutSessions.quantity,
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

  const deployment = resolveDeploymentForMode(session.livemode);

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

  // Blocklist: wallet / email / country. Load once per relay attempt —
  // small per-org row count, fine to do inline without caching.
  const blocklist = await loadOrgBlocklist(
    session.organizationId,
    session.livemode,
  );
  if (blocklist.length > 0) {
    const hit = findBlocklistMatch({
      wallet: buyer,
      email: session.buyerEmail ?? null,
      country: session.buyerCountry ?? null,
      entries: blocklist,
    });
    if (hit) {
      return NextResponse.json(
        { error: { code: "blocked", message: BLOCKLIST_MESSAGE } },
        { status: 403 },
      );
    }
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
  let normalizedBuyerEmail: string | null = null;
  if (runTrialBranch) {
    const rawBuyerEmail = session.buyerEmail?.trim() ?? null;
    if (!rawBuyerEmail) {
      return NextResponse.json(
        {
          error: {
            code: "email_required",
            message: "An email address is required to start a free trial.",
          },
        },
        { status: 400 },
      );
    }
    if (isDisposableEmail(rawBuyerEmail)) {
      return NextResponse.json(
        {
          error: {
            code: "disposable_email",
            message: "Disposable email addresses are not allowed for free trials.",
          },
        },
        { status: 400 },
      );
    }
    normalizedBuyerEmail = normalizeEmail(rawBuyerEmail);

    if (session.networkKey && session.tokenSymbol) {
      const wallet = await checkWalletActivity({
        address: buyer as `0x${string}`,
        networkKey: session.networkKey,
        tokenSymbol: session.tokenSymbol,
      });
      if (!wallet.active) {
        return NextResponse.json(
          {
            error: {
              code: "wallet_inactive",
              message:
                "This wallet has no transaction history. Please use a wallet with on-chain activity to start a free trial.",
            },
          },
          { status: 400 },
        );
      }
    }

    const dedup = await checkExistingSubscription({
      organizationId: session.organizationId,
      productId: session.productId,
      buyerWallet: buyer,
      customerIdentifier: session.customerId ?? null,
      buyerEmail: normalizedBuyerEmail,
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
          email: normalizedBuyerEmail,
          phone: session.buyerPhone ?? null,
        })
        .returning();
      customer = created;
    } else {
      const customerPatch: Record<string, string | null> = {};
      if (!customer.walletAddress) customerPatch.walletAddress = buyer;
      if (!customer.firstName && session.buyerFirstName) customerPatch.firstName = session.buyerFirstName;
      if (!customer.lastName && session.buyerLastName) customerPatch.lastName = session.buyerLastName;
      if (!customer.email && normalizedBuyerEmail) customerPatch.email = normalizedBuyerEmail;
      if (!customer.phone && session.buyerPhone) customerPatch.phone = session.buyerPhone;
      if (!customer.country && session.buyerCountry) customerPatch.country = session.buyerCountry;
      if (!customer.taxId && session.buyerTaxId) customerPatch.taxId = session.buyerTaxId;
      if (Object.keys(customerPatch).length > 0) {
        await db.update(customers).set(customerPatch).where(eq(customers.id, customer.id));
        customer = { ...customer, ...customerPatch } as typeof customer;
      }
    }

    // Trial + subscription paths are EIP-2612-only today; the eip2612 guard
    // at the top of the route ensures these fields are non-null when we get
    // here. Asserting with ! rather than branching keeps the trial snapshot
    // shape stable for the trial-converter later.
    const pendingPermitSignature = {
      permit: {
        value: permitValue!.toString(),
        deadline: Number(deadline),
        v: Number(v!),
        r: r!,
        s: s!,
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
        contractAddress: deployment.subscriptionManager.toLowerCase(),
        networkKey: session.networkKey!,
        tokenSymbol: session.tokenSymbol!,
        status: "trialing",
        trialEndsAt,
        pendingPermitSignature,
        intervalSeconds: Number(intervalSeconds),
        appliedCouponId: session.appliedCouponId,
        quantity: session.quantity,
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

    void dispatchWebhooks(session.organizationId, "subscription.trial_started", {
      subscriptionId: newSub.id,
      checkoutId: session.id,
      productId: session.productId,
      customerId: customer.customerId,
      subscriberAddress: buyer,
      trialEndsAt: trialEndsAt.toISOString(),
      metadata: newSub.metadata ?? {},
    }).catch((err) => console.error("[Relay] trial_started webhook failed:", err));

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
      buyerEmail: null,
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
  const relayer = createRelayerClient(deployment);
  let txHash: `0x${string}`;

  // Resolve the actual token address + scheme from the registry. Payments
  // for non-USDC tokens (USDT / WETH / DAI / etc.) target the token's
  // canonical address, not deployment.usdcAddress. The scheme routes the
  // call to the right vault function.
  const tokenConfig = getToken(
    session.networkKey as NetworkKey,
    session.tokenSymbol,
  );
  const tokenAddress = resolveTokenAddress(tokenConfig);
  const scheme = tokenConfig.signatureScheme;

  if (scheme === "none" || scheme === "dai-permit") {
    await releaseRelayLock(db, sessionId).catch(() => {});
    return NextResponse.json(
      {
        error: {
          code: "scheme_not_supported",
          message: `Token ${session.tokenSymbol} on ${session.networkKey} uses the '${scheme}' signature scheme, which the relay route doesn't execute yet. Track follow-up work in issue #56.`,
        },
      },
      { status: 400 },
    );
  }

  // Body-shape guard: Permit2 tokens need permit2Nonce/permit2Signature,
  // EIP-2612 tokens need v/r/s/permitValue. validation.ts accepts either
  // but doesn't know which the session's token requires.
  if (scheme === "permit2" && (permit2Nonce === null || permit2Signature === null)) {
    await releaseRelayLock(db, sessionId).catch(() => {});
    return NextResponse.json(
      {
        error: {
          code: "invalid_body",
          message: `Token ${session.tokenSymbol} uses Permit2; request must include permit2Nonce and permit2Signature.`,
        },
      },
      { status: 400 },
    );
  }
  if (scheme === "eip2612" && (v === null || r === null || s === null || permitValue === null)) {
    await releaseRelayLock(db, sessionId).catch(() => {});
    return NextResponse.json(
      {
        error: {
          code: "invalid_body",
          message: `Token ${session.tokenSymbol} uses EIP-2612; request must include v, r, s, and permitValue.`,
        },
      },
      { status: 400 },
    );
  }

  try {
    if (isSubscription) {
      // Permit2 subscriptions (#55 part 2) require an AllowanceTransfer
      // PermitSingle grant which the checkout client would need to sign
      // and this body shape would need to carry. Follow-up work.
      if (scheme === "permit2") {
        await releaseRelayLock(db, sessionId).catch(() => {});
        return NextResponse.json(
          {
            error: {
              code: "scheme_not_supported",
              message: "Permit2 subscriptions are contract-ready (#55 part 2) but the relay payload wiring is follow-up work. One-time Permit2 payments work today.",
            },
          },
          { status: 400 },
        );
      }
      const intervalSeconds = BigInt(intervalToSeconds(session.billingInterval));
      if (intervalSeconds <= BigInt(0)) {
        return NextResponse.json(
          { error: { code: "invalid_interval", message: "Product has no valid billing interval" } },
          { status: 400 },
        );
      }

      // Load the coupon once so we can decide whether to route to the
      // discount-aware contract function. Only once/repeating coupons on
      // subscriptions take that path — forever coupons already mutated
      // session.amount at apply-coupon time and use the plain function.
      const couponRow = session.appliedCouponId
        ? await db
            .select({
              duration: coupons.duration,
              durationInCycles: coupons.durationInCycles,
            })
            .from(coupons)
            .where(eq(coupons.id, session.appliedCouponId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : null;
      const useDiscountPath =
        couponRow &&
        (couponRow.duration === "once" || couponRow.duration === "repeating") &&
        session.discountCents != null;

      if (useDiscountPath) {
        const discountAmount = BigInt(session.discountCents!);
        const discountCycles = BigInt(
          couponRow.duration === "once" ? 1 : couponRow.durationInCycles ?? 1,
        );
        // Subscription path guarded at the top — scheme=permit2 subs are
        // rejected before reaching here, so the ! asserts are sound.
        txHash = await withRetry(() => relayer.writeContract({
          address: deployment.subscriptionManager,
          abi: SUBSCRIPTION_MANAGER_ABI,
          functionName: "createSubscriptionWithPermitDiscount",
          args: [
            {
              token: tokenAddress,
              buyer,
              merchant: session.merchantWallet as `0x${string}`,
              amount: tokenAmount,
              interval: intervalSeconds,
              productId: productIdBytes,
              customerId: customerIdBytes,
              permitValue: permitValue!,
              discountAmount,
              discountCycles,
              deadline,
              v: v!,
              r: r!,
              s: s!,
            },
            intentSignature,
          ],
        }));
      } else {
        txHash = await withRetry(() => relayer.writeContract({
          address: deployment.subscriptionManager,
          abi: SUBSCRIPTION_MANAGER_ABI,
          functionName: "createSubscriptionWithPermit",
          args: [
            {
              token: tokenAddress,
              buyer,
              merchant: session.merchantWallet as `0x${string}`,
              amount: tokenAmount,
              interval: intervalSeconds,
              productId: productIdBytes,
              customerId: customerIdBytes,
              permitValue: permitValue!,
              deadline,
              v: v!,
              r: r!,
              s: s!,
            },
            intentSignature,
          ],
        }));
      }
    } else if (scheme === "permit2") {
      // Permit2 one-time: the buyer's Permit2 signature authorizes a single
      // transfer of `tokenAmount` of `tokenAddress`. The vault verifies the
      // intent binding first, then pulls via Permit2.permitTransferFrom.
      txHash = await withRetry(() => relayer.writeContract({
        address: deployment.paymentVault,
        abi: PAYMENT_VAULT_ABI,
        functionName: "createPaymentWithPermit2",
        args: [
          {
            token: tokenAddress,
            buyer,
            merchant: session.merchantWallet as `0x${string}`,
            amount: tokenAmount,
            productId: productIdBytes,
            customerId: customerIdBytes,
            permit2Nonce: permit2Nonce as bigint,
            permit2Deadline: deadline,
            permit2Signature: permit2Signature as `0x${string}`,
            intentSignature,
          },
        ],
      }));
    } else {
      // scheme === "eip2612" — classic permit path.
      txHash = await withRetry(() => relayer.writeContract({
        address: deployment.paymentVault,
        abi: PAYMENT_VAULT_ABI,
        functionName: "createPaymentWithPermit",
        args: [
          tokenAddress,
          buyer,
          session.merchantWallet as `0x${string}`,
          tokenAmount,
          productIdBytes,
          customerIdBytes,
          { deadline, v: v as number, r: r as `0x${string}`, s: s as `0x${string}` },
          intentSignature,
        ],
      }));
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

  // Coupon redemption bookkeeping. Fires on both one-time and
  // subscription (forever) coupons — subscription coupons get logged
  // once at sub creation because every recurring charge runs at the
  // same discounted on-chain amount.
  if (session.appliedCouponId && session.discountCents) {
    const couponId = session.appliedCouponId;
    const discountCents = session.discountCents;
    void (async () => {
      try {
        // Atomic increment gated on max_redemptions. If the coupon is
        // already exhausted (another buyer claimed the last slot during
        // the relay window), we still accept this payment — the chain
        // call already succeeded — but we don't record the redemption.
        const [incremented] = await db
          .update(coupons)
          .set({ redemptionCount: sql`${coupons.redemptionCount} + 1` })
          .where(
            and(
              eq(coupons.id, couponId),
              eq(coupons.isActive, true),
              or(
                isNull(coupons.maxRedemptions),
                sql`${coupons.redemptionCount} < ${coupons.maxRedemptions}`,
              ),
            ),
          )
          .returning({ id: coupons.id });
        if (!incremented) return;

        await db.insert(couponRedemptions).values({
          couponId,
          organizationId: session.organizationId,
          checkoutSessionId: session.id,
          discountCents,
          cycleNumber: 0,
          livemode: session.livemode,
        });

        void dispatchWebhooks(session.organizationId, "coupon.redeemed", {
          couponId,
          checkoutSessionId: session.id,
          discountCents,
          amount: session.amount.toString(),
          subtotalAmount: session.subtotalAmount?.toString() ?? null,
          metadata: session.metadata ?? {},
        }).catch((err) => console.error("[Relay] coupon.redeemed webhook failed:", err));
      } catch (err) {
        console.error("[Relay] coupon redemption bookkeeping failed:", err);
      }
    })();
  }

  return NextResponse.json({ txHash });
}
