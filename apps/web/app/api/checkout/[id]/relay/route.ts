import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import { db } from "@/lib/db";
import { checkoutSessions, products } from "@paylix/db/schema";
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
import { checkRateLimit } from "@/lib/rate-limit";

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

  // 2. Deadline sanity check (cheap — avoids a DB roundtrip on stale signatures)
  const deadlineCheck = validateDeadline(deadline);
  if (!deadlineCheck.ok) return errorResponse(deadlineCheck.error);

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
      merchantWallet: checkoutSessions.merchantWallet,
      productId: checkoutSessions.productId,
      billingInterval: products.billingInterval,
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

  // 4. Compute on-chain args
  // session.amount is in cents; USDC has 6 decimals; $1.00 = 1,000,000 units = 100 cents
  const usdcAmount = BigInt(session.amount) * BigInt(10_000);
  const productIdBytes = keccak256(stringToBytes(session.productId));
  // Use the session UUID as the on-chain customerId — avoids collisions
  // across concurrent checkouts and matches the existing direct-flow pattern
  const customerIdBytes = keccak256(stringToBytes(session.id));
  const isSubscription = session.type === "subscription";

  // 5. Submit the relayed transaction
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
            amount: usdcAmount,
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
          usdcAmount,
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
