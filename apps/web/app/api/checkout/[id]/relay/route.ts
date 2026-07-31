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
  FLOW_EIP2612,
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
import { clientIpKey } from "../../../_shared/client-ip";
import { orgScope } from "@/lib/org-scope";
import {
  getPlatformFeeBps,
  MAX_PLATFORM_FEE_BPS,
} from "../../../_shared/platform-fee";

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
  const ip = clientIpKey(request);
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
    permit2Allowance,
    daiPermit,
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
      // Fee ceiling stamped at quote time; the buyer signed over this exact
      // value, so it is replayed verbatim rather than recomputed.
      maxFeeBps: checkoutSessions.maxFeeBps,
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

  // Resolve the token's signature scheme and check the request carries the
  // matching payload. This MUST happen before the trial branch: the trial
  // path dereferences permitValue/v/r/s and parseRelayBody leaves those null
  // for any Permit2 or DAI-permit shape, so a trial checkout on a Permit2
  // token used to throw a TypeError and return an unhandled 500.
  //
  // All of these guards run before acquireRelayLock, so none of them needs
  // to release it.
  const tokenConfig = getToken(
    session.networkKey as NetworkKey,
    session.tokenSymbol,
  );
  const tokenAddress = resolveTokenAddress(tokenConfig);
  const scheme = tokenConfig.signatureScheme;

  if (scheme === "none") {
    return NextResponse.json(
      {
        error: {
          code: "scheme_not_supported",
          message: `Token ${session.tokenSymbol} on ${session.networkKey} has no gasless path configured.`,
        },
      },
      { status: 400 },
    );
  }
  if (scheme === "dai-permit" && session.type === "subscription") {
    return NextResponse.json(
      {
        error: {
          code: "scheme_not_supported",
          message: "DAI-permit subscriptions aren't wired yet. Use DAI one-time or switch to a Permit2-compatible chain.",
        },
      },
      { status: 400 },
    );
  }
  if (scheme === "dai-permit" && daiPermit === null) {
    return NextResponse.json(
      {
        error: { code: "invalid_body", message: `Token ${session.tokenSymbol} uses DAI-permit; request must include daiPermit.` },
      },
      { status: 400 },
    );
  }

  // Body-shape guard: Permit2 tokens need either the one-time
  // (permit2Nonce + permit2Signature) or AllowanceTransfer (permit2Allowance)
  // payload. EIP-2612 tokens need v/r/s/permitValue. Validation.ts accepts
  // any shape; here we check the one that matches the scheme + product type.
  if (scheme === "permit2") {
    const isSub = session.type === "subscription";
    const hasOneTime = permit2Nonce !== null && permit2Signature !== null;
    const hasAllowance = permit2Allowance !== null;
    if (isSub && !hasAllowance) {
      return NextResponse.json(
        { error: { code: "invalid_body", message: `Subscription with ${session.tokenSymbol} requires a Permit2 AllowanceTransfer payload (permit2Allowance).` } },
        { status: 400 },
      );
    }
    if (!isSub && !hasOneTime) {
      return NextResponse.json(
        { error: { code: "invalid_body", message: `One-time payment with ${session.tokenSymbol} requires Permit2 SignatureTransfer (permit2Nonce/permit2Signature).` } },
        { status: 400 },
      );
    }
  }
  if (scheme === "eip2612" && (v === null || r === null || s === null || permitValue === null)) {
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

  // Fee ceiling the buyer bound into their intent signature. Read from the
  // session, NOT from the request body and NOT live from `platformFee()`:
  //
  //  - a client-supplied ceiling is worthless, since the whole point is to
  //    protect the buyer from a fee raise;
  //  - a live read races an owner fee raise between quote and signature,
  //    which is exactly the window SC-03 closes. The value is stamped on the
  //    session at quote time and is what the client signed over, so replaying
  //    it verbatim is the only thing that reproduces the digest.
  const maxFeeBps = session.maxFeeBps;
  if (maxFeeBps === null || maxFeeBps === undefined) {
    return NextResponse.json(
      {
        error: {
          code: "fee_ceiling_missing",
          message:
            "This checkout session predates fee-ceiling capture and can no longer be paid. Start a new checkout.",
        },
      },
      { status: 409 },
    );
  }
  if (maxFeeBps < 0 || BigInt(maxFeeBps) > MAX_PLATFORM_FEE_BPS) {
    // Defensive: a stored value out of range would revert on-chain with
    // "maxFeeBps too high". Fail here with something actionable.
    console.error(
      `[Relay] session ${session.id} has out-of-range maxFeeBps=${maxFeeBps}`,
    );
    return NextResponse.json(
      { error: { code: "fee_ceiling_invalid", message: "Invalid fee ceiling on this session." } },
      { status: 409 },
    );
  }
  const maxFeeBpsBig = BigInt(maxFeeBps);

  // Sanity check in exactly the form the contract enforces:
  //   require(platformFee <= maxFeeBps, "Fee above signed max")
  // An owner fee RAISE above the signed ceiling voids the intent — that is
  // SC-03 working as designed, and failing here gives the buyer a readable
  // error instead of an opaque on-chain revert. An owner fee DROP still
  // settles, matching `_feeBpsFor`, which clamps downward only.
  //
  // This is a *check*, never a source: the value passed to the contract is
  // always the stored one the buyer signed over.
  try {
    const currentFeeBps = await getPlatformFeeBps({
      contractAddress: isSubscription
        ? deployment.subscriptionManager
        : deployment.paymentVault,
      chain: deployment.chain,
      chainId: deployment.chainId,
      rpcUrl: deployment.rpcUrl,
    });
    if (currentFeeBps > maxFeeBpsBig) {
      return NextResponse.json(
        {
          error: {
            code: "fee_above_signed_max",
            message:
              "The platform fee changed after this checkout was quoted. Start a new checkout to continue.",
          },
        },
        { status: 409 },
      );
    }
  } catch (err) {
    // A read failure must not block a payment the contract would accept —
    // the contract enforces the same rule authoritatively a moment later.
    console.warn("[Relay] platformFee sanity read failed; deferring to chain:", err);
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

  // Acquire the atomic session lock BEFORE the trial branch. The trial path
  // is a read-then-write (dedup check → customer upsert → subscriptions
  // insert → session update) and used to run entirely outside the lock, so
  // two simultaneous POSTs both passed the dedup check and both inserted a
  // `trialing` row with stored permit signatures — which the trial converter
  // later replayed twice, creating two on-chain subscriptions for one buyer.
  //
  // On success the indexer's session-completed update supersedes the lock;
  // every failure path below releases it so the buyer can retry.
  const locked = await acquireRelayLock(db, sessionId);
  if (!locked) {
    return NextResponse.json(
      { error: { code: "session_already_relayed" } },
      { status: 409 },
    );
  }
  const unlock = () => releaseRelayLock(db, sessionId).catch(() => {});

  let runTrialBranch = isTrial;
  let normalizedBuyerEmail: string | null = null;
  if (runTrialBranch) {
    const rawBuyerEmail = session.buyerEmail?.trim() ?? null;
    if (!rawBuyerEmail) {
      await unlock();
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
      await unlock();
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
        // Without an explicit RPC the check silently falls back to the
        // public node and the "no on-chain history → no trial" control
        // degrades to always-allow.
        rpcUrl: deployment.rpcUrl,
      });
      if (!wallet.active) {
        await unlock();
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
      livemode: session.livemode,
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
      await unlock();
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
      // Upsert rather than plain insert: the lock serialises relay attempts
      // for this session, but the same (org, customerId) pair can be reached
      // concurrently from a different session.
      const [created] = await db
        .insert(customers)
        .values({
          organizationId: session.organizationId,
          livemode: session.livemode,
          customerId: customerIdentifier,
          walletAddress: buyer,
          country: session.buyerCountry ?? null,
          taxId: session.buyerTaxId ?? null,
          firstName: session.buyerFirstName ?? null,
          lastName: session.buyerLastName ?? null,
          email: normalizedBuyerEmail,
          phone: session.buyerPhone ?? null,
        })
        .onConflictDoUpdate({
          target: [customers.organizationId, customers.customerId],
          set: { walletAddress: buyer },
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

    // Trial + subscription paths are EIP-2612-only today. The scheme guard
    // above this branch has already rejected every non-2612 token, so these
    // fields are non-null here.
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
        // Part of the signed SubscriptionIntent digest, so the trial
        // converter MUST replay this exact value — recomputing it from the
        // platform fee at conversion time would break the signature if the
        // owner changed the fee during the trial, which is precisely the
        // attack SC-03 closes. The converter refuses any stored intent
        // without it rather than burning gas on an unverifiable call.
        maxFeeBps: maxFeeBps.toString(),
        // NOT calldata — `flow` exists only inside the EIP-712 typehash and
        // each entry point substitutes its own constant
        // (SubscriptionManager.sol:360 passes FLOW_EIP2612). Stored so the
        // converter can refuse to replay a Permit2-signed intent through the
        // EIP-2612 entry point. Trials are EIP-2612-only today, enforced by
        // the scheme guard above this branch.
        flow: FLOW_EIP2612,
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
        livemode: session.livemode,
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
    }, session.livemode).catch((err) => console.error("[Relay] trial_started webhook failed:", err));

    return NextResponse.json({
      trial: true,
      subscriptionId: newSub.id,
      trialEndsAt: trialEndsAt.toISOString(),
      customerUuid: customer.id,
      // Optional convenience field — a misconfigured portal secret must not
      // fail a trial that has already been recorded.
      portalToken: (() => {
        try {
          return signPortalToken(customer.id);
        } catch (err) {
          console.error("[Relay] portal token unavailable:", err);
          return null;
        }
      })(),
    });
  }

  if (isSubscription) {
    const dedup = await checkExistingSubscription({
      organizationId: session.organizationId,
      livemode: session.livemode,
      productId: session.productId,
      buyerWallet: buyer,
      customerIdentifier: session.customerId ?? null,
      buyerEmail: null,
      intent: "subscription",
    });
    if (dedup.exists) {
      await unlock();
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

  // 6. Submit the relayed transaction
  // session.amount is now stored in native token units (bigint), no
  // conversion needed. The old cents × 10_000 math is gone — amounts are
  // whatever the merchant set in the product_prices entry for this
  // (networkKey, tokenSymbol) pair.
  const relayer = createRelayerClient(deployment);
  let txHash: `0x${string}`;

  try {
    if (isSubscription) {
      const intervalSeconds = BigInt(intervalToSeconds(session.billingInterval));
      if (intervalSeconds <= BigInt(0)) {
        await unlock();
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
            .where(
              and(
                eq(coupons.id, session.appliedCouponId),
                orgScope(coupons, {
                  organizationId: session.organizationId,
                  livemode: session.livemode,
                }),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : null;
      const useDiscountPath =
        couponRow &&
        (couponRow.duration === "once" || couponRow.duration === "repeating") &&
        session.discountCents != null;

      // Permit2 AllowanceTransfer path — buyer pre-granted the
      // SubscriptionManager PDA an allowance covering N cycles. The keeper
      // pulls per cycle via Permit2.transferFrom.
      if (scheme === "permit2") {
        // Discount coupons (once / repeating) aren't wired to Permit2 subs
        // yet — the contract-side createSubscriptionWithPermit2Discount
        // doesn't exist. Forever coupons pre-apply to amount so they're fine.
        if (useDiscountPath) {
          await unlock();
          return NextResponse.json(
            {
              error: {
                code: "scheme_not_supported",
                message:
                  "Once/repeating coupons on Permit2 subscriptions aren't supported yet. Use a forever coupon or an EIP-2612 token for now.",
              },
            },
            { status: 400 },
          );
        }
        const allowance = permit2Allowance!;
        txHash = await withRetry(() => relayer.writeContract({
          address: deployment.subscriptionManager,
          abi: SUBSCRIPTION_MANAGER_ABI,
          functionName: "createSubscriptionWithPermit2",
          args: [
            {
              token: tokenAddress,
              buyer,
              merchant: session.merchantWallet as `0x${string}`,
              amount: tokenAmount,
              interval: intervalSeconds,
              productId: productIdBytes,
              customerId: customerIdBytes,
              maxFeeBps: maxFeeBpsBig,
              deadline,
            },
            {
              details: {
                token: tokenAddress,
                amount: allowance.amount,
                expiration: allowance.expiration,
                nonce: allowance.nonce,
              },
              spender: deployment.subscriptionManager,
              sigDeadline: allowance.sigDeadline,
            },
            allowance.signature,
            intentSignature,
          ],
        }));
      } else if (useDiscountPath) {
        const discountAmount = BigInt(session.discountCents!);
        const discountCycles = BigInt(
          couponRow.duration === "once" ? 1 : couponRow.durationInCycles ?? 1,
        );
        // Subscription path with eip2612 + discount coupon.
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
              maxFeeBps: maxFeeBpsBig,
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
              maxFeeBps: maxFeeBpsBig,
              deadline,
              v: v!,
              r: r!,
              s: s!,
            },
            intentSignature,
          ],
        }));
      }
    } else if (scheme === "dai-permit") {
      // Ethereum-mainnet DAI one-time only. Subscriptions rejected above.
      const dp = daiPermit!;
      txHash = await withRetry(() => relayer.writeContract({
        address: deployment.paymentVault,
        abi: PAYMENT_VAULT_ABI,
        functionName: "createPaymentWithDaiPermit",
        args: [
          {
            token: tokenAddress,
            buyer,
            merchant: session.merchantWallet as `0x${string}`,
            amount: tokenAmount,
            productId: productIdBytes,
            customerId: customerIdBytes,
            maxFeeBps: maxFeeBpsBig,
            daiNonce: dp.nonce,
            permitExpiry: deadline,
            v: dp.v,
            r: dp.r,
            s: dp.s,
            intentSignature,
          },
        ],
      }));
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
            maxFeeBps: maxFeeBpsBig,
            permit2Nonce: permit2Nonce as bigint,
            permit2Deadline: deadline,
            permit2Signature: permit2Signature as `0x${string}`,
            intentSignature,
          },
        ],
      }));
    } else {
      // scheme === "eip2612" — classic permit path. Takes a PaymentIntentData
      // struct (note: `buyer` before `token`, unlike the Permit2/DAI structs)
      // plus a separate PermitSig. `d.deadline` must equal
      // `permitSig.deadline` — the contract requires them to match.
      txHash = await withRetry(() => relayer.writeContract({
        address: deployment.paymentVault,
        abi: PAYMENT_VAULT_ABI,
        functionName: "createPaymentWithPermit",
        args: [
          {
            buyer,
            token: tokenAddress,
            merchant: session.merchantWallet as `0x${string}`,
            amount: tokenAmount,
            productId: productIdBytes,
            customerId: customerIdBytes,
            maxFeeBps: maxFeeBpsBig,
            deadline,
          },
          { deadline, v: v as number, r: r as `0x${string}`, s: s as `0x${string}` },
          intentSignature,
        ],
      }));
    }
  } catch (err) {
    // Release the lock so the user can retry
    await unlock();
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
              orgScope(coupons, {
                organizationId: session.organizationId,
                livemode: session.livemode,
              }),
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
        }, session.livemode).catch((err) => console.error("[Relay] coupon.redeemed webhook failed:", err));
      } catch (err) {
        console.error("[Relay] coupon redemption bookkeeping failed:", err);
      }
    })();
  }

  return NextResponse.json({ txHash });
}
