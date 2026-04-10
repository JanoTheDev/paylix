import { createDb } from "@paylix/db/client";
import {
  payments,
  subscriptions,
  checkoutSessions,
  customers,
  unmatchedEvents,
} from "@paylix/db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { keccak256, stringToBytes, type Log } from "viem";
import { config } from "./config";
import { dispatchWebhooks } from "./webhook-dispatch";

async function recordUnmatched(
  eventType: string,
  log: Log,
  payload: Record<string, unknown>
) {
  if (!log.transactionHash) return;
  try {
    await db.insert(unmatchedEvents).values({
      eventType,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber ? Number(log.blockNumber) : null,
      logIndex: typeof log.logIndex === "number" ? log.logIndex : null,
      payload,
    });
    console.warn(
      `[Handler] Recorded unmatched ${eventType} event tx=${log.transactionHash} for retry`
    );
  } catch (err) {
    console.error("[Handler] Failed to record unmatched event:", err);
  }
}

function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

const db = createDb(config.databaseUrl);

export async function handlePaymentReceived(log: Log, args: {
  payer: `0x${string}`;
  merchant: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  fee: bigint;
  productId: `0x${string}`;
  customerId: `0x${string}`;
  timestamp: bigint;
}) {
  console.log("[Handler] PaymentReceived:", {
    txHash: log.transactionHash,
    payer: args.payer,
    merchant: args.merchant,
    amount: args.amount.toString(),
    blockNumber: log.blockNumber?.toString(),
  });

  if (!log.transactionHash) {
    console.log("[Handler] No transaction hash, skipping");
    return;
  }

  // Idempotency: skip if we already have a payment for this tx hash
  const [existingPayment] = await db
    .select()
    .from(payments)
    .where(eq(payments.txHash, log.transactionHash))
    .limit(1);
  if (existingPayment) {
    console.log(
      `[Handler] Payment for tx ${log.transactionHash} already exists, skipping`
    );
    return;
  }

  // Convert on-chain amount (USDC 6 decimals) back to cents
  // 1 USDC = 1,000,000 units = 100 cents
  const amountCents = Number(args.amount) / 10_000;

  // Match by reversing the customerId hash: the checkout-client encodes
  // keccak256(stringToBytes(session.id)) as the on-chain customerId to avoid
  // collisions on (merchant, amount). Scan recent open sessions for this
  // merchant and find the one whose id hashes to the provided customerId.
  const candidates = await db
    .select()
    .from(checkoutSessions)
    .where(
      and(
        sql`lower(${checkoutSessions.merchantWallet}) = lower(${args.merchant})`,
        or(
          eq(checkoutSessions.status, "viewed"),
          eq(checkoutSessions.status, "active")
        )
      )
    )
    .orderBy(desc(checkoutSessions.createdAt))
    .limit(200);

  const targetCustomerId = args.customerId.toLowerCase();
  const session = candidates.find(
    (s) => keccak256(stringToBytes(s.id)).toLowerCase() === targetCustomerId
  );

  if (!session) {
    console.log(
      `[Handler] No matching checkout session for merchant=${args.merchant} customerId=${args.customerId}`
    );
    await recordUnmatched("PaymentReceived", log, serializeArgs(args));
    return;
  }

  console.log(`[Handler] Matched checkout session ${session.id}`);

  // Create or find customer record
  const customerIdentifier = session.customerId || `anon_${args.payer}`;
  let [customer] = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.userId, session.userId),
        eq(customers.customerId, customerIdentifier)
      )
    );

  if (!customer) {
    const [created] = await db
      .insert(customers)
      .values({
        userId: session.userId,
        customerId: customerIdentifier,
        walletAddress: args.payer,
      })
      .returning();
    customer = created;
    console.log(`[Handler] Created customer ${customer.id}`);
  } else if (!customer.walletAddress) {
    await db
      .update(customers)
      .set({ walletAddress: args.payer })
      .where(eq(customers.id, customer.id));
  }

  // Create payment record
  const [payment] = await db
    .insert(payments)
    .values({
      productId: session.productId,
      userId: session.userId,
      customerId: customer.id,
      amount: amountCents,
      fee: Number(args.fee) / 10_000,
      status: "confirmed",
      txHash: log.transactionHash,
      chain: session.chain,
      token: session.currency,
      fromAddress: args.payer,
      toAddress: args.merchant,
      blockNumber: log.blockNumber ? Number(log.blockNumber) : null,
    })
    .returning();

  console.log(`[Handler] Created payment ${payment.id}`);

  // Update checkout session to completed
  await db
    .update(checkoutSessions)
    .set({
      status: "completed",
      completedAt: new Date(),
      paymentId: payment.id,
    })
    .where(eq(checkoutSessions.id, session.id));

  console.log(`[Handler] Checkout session ${session.id} marked completed`);

  // Dispatch webhook
  await dispatchWebhooks(session.userId, "payment.confirmed", {
    paymentId: payment.id,
    checkoutId: session.id,
    productId: session.productId,
    customerId: customer.customerId,
    amount: payment.amount,
    fee: payment.fee,
    currency: payment.token,
    chain: payment.chain,
    txHash: log.transactionHash,
    fromAddress: args.payer,
    toAddress: args.merchant,
    metadata: session.metadata ?? {},
  });
}

export async function handleSubscriptionCreated(log: Log, args: {
  subscriptionId: bigint;
  subscriber: `0x${string}`;
  merchant: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  interval: bigint;
  productId: `0x${string}`;
  customerId: `0x${string}`;
}) {
  console.log("[Handler] SubscriptionCreated:", {
    txHash: log.transactionHash,
    subscriptionId: args.subscriptionId.toString(),
    subscriber: args.subscriber,
    merchant: args.merchant,
    amount: args.amount.toString(),
    interval: args.interval.toString(),
  });

  if (!log.transactionHash) {
    console.log("[Handler] No transaction hash, skipping");
    return;
  }

  const onChainId = args.subscriptionId.toString();

  // Idempotency: if we already have a subscription for this onChainId, skip
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.onChainId, onChainId))
    .limit(1);

  if (existing) {
    console.log(`[Handler] Subscription ${onChainId} already exists, skipping`);
    return;
  }

  const amountCents = Number(args.amount) / 10_000;
  const intervalSeconds = Number(args.interval);

  // Match the checkout session by reversing the session.id hash encoded as
  // the on-chain customerId.
  const candidates = await db
    .select()
    .from(checkoutSessions)
    .where(
      and(
        sql`lower(${checkoutSessions.merchantWallet}) = lower(${args.merchant})`,
        eq(checkoutSessions.type, "subscription"),
        or(
          eq(checkoutSessions.status, "viewed"),
          eq(checkoutSessions.status, "active")
        )
      )
    )
    .orderBy(desc(checkoutSessions.createdAt))
    .limit(200);

  const targetCustomerId = args.customerId.toLowerCase();
  const session = candidates.find(
    (s) => keccak256(stringToBytes(s.id)).toLowerCase() === targetCustomerId
  );

  if (!session) {
    console.log(
      `[Handler] No matching subscription checkout session for merchant=${args.merchant} customerId=${args.customerId}`
    );
    await recordUnmatched("SubscriptionCreated", log, serializeArgs(args));
    return;
  }

  console.log(`[Handler] Matched subscription checkout session ${session.id}`);

  // Create or find customer
  const customerIdentifier = session.customerId || `anon_${args.subscriber}`;
  let [customer] = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.userId, session.userId),
        eq(customers.customerId, customerIdentifier)
      )
    );

  if (!customer) {
    const [created] = await db
      .insert(customers)
      .values({
        userId: session.userId,
        customerId: customerIdentifier,
        walletAddress: args.subscriber,
      })
      .returning();
    customer = created;
    console.log(`[Handler] Created customer ${customer.id}`);
  } else if (!customer.walletAddress) {
    await db
      .update(customers)
      .set({ walletAddress: args.subscriber })
      .where(eq(customers.id, customer.id));
  }

  // Create first payment (the initial charge happens atomically with createSubscription)
  const [payment] = await db
    .insert(payments)
    .values({
      productId: session.productId,
      userId: session.userId,
      customerId: customer.id,
      amount: amountCents,
      fee: 0, // fee is tracked per-charge in PaymentReceived; creation doesn't include it here
      status: "confirmed",
      txHash: log.transactionHash,
      chain: session.chain,
      token: session.currency,
      fromAddress: args.subscriber,
      toAddress: args.merchant,
      blockNumber: log.blockNumber ? Number(log.blockNumber) : null,
    })
    .returning();

  console.log(`[Handler] Created initial subscription payment ${payment.id}`);

  const now = new Date();
  const nextCharge = new Date(now.getTime() + intervalSeconds * 1000);

  // Create subscription row
  const [subscription] = await db
    .insert(subscriptions)
    .values({
      productId: session.productId,
      userId: session.userId,
      customerId: customer.id,
      subscriberAddress: args.subscriber,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: nextCharge,
      nextChargeDate: nextCharge,
      lastPaymentId: payment.id,
      onChainId,
      intervalSeconds,
      metadata: session.metadata ?? {},
    })
    .returning();

  console.log(`[Handler] Created subscription ${subscription.id} (onChainId: ${onChainId})`);

  // Mark checkout session completed and link to subscription
  await db
    .update(checkoutSessions)
    .set({
      status: "completed",
      completedAt: new Date(),
      paymentId: payment.id,
    })
    .where(eq(checkoutSessions.id, session.id));

  console.log(`[Handler] Checkout session ${session.id} marked completed`);

  // Dispatch webhook
  await dispatchWebhooks(session.userId, "subscription.created", {
    subscriptionId: subscription.id,
    onChainId,
    checkoutId: session.id,
    productId: session.productId,
    customerId: customer.customerId,
    amount: amountCents,
    currency: session.currency,
    chain: session.chain,
    interval: intervalSeconds,
    subscriberAddress: args.subscriber,
    merchantAddress: args.merchant,
    txHash: log.transactionHash,
    metadata: subscription.metadata ?? {},
  });
}

export async function handleSubscriptionPaymentReceived(log: Log, args: {
  subscriptionId: bigint;
  subscriber: `0x${string}`;
  merchant: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
}) {
  console.log("[Handler] Subscription PaymentReceived:", {
    txHash: log.transactionHash,
    subscriptionId: args.subscriptionId.toString(),
    amount: args.amount.toString(),
  });

  if (!log.transactionHash) return;

  const onChainId = args.subscriptionId.toString();

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.onChainId, onChainId))
    .limit(1);

  if (!subscription) {
    // Subscription not yet created (SubscriptionCreated event may arrive in the
    // same batch). The initial charge's payment record is created by
    // handleSubscriptionCreated, so silently skip here.
    console.log(
      `[Handler] No subscription found for onChainId=${onChainId}; likely the initial charge. Skipping.`
    );
    return;
  }

  // Idempotency: if we already have a payment with this txHash linked to this
  // subscription's customer, skip.
  const [existingPayment] = await db
    .select()
    .from(payments)
    .where(eq(payments.txHash, log.transactionHash))
    .limit(1);

  if (existingPayment) {
    console.log(`[Handler] Payment for tx ${log.transactionHash} already exists, skipping`);
    return;
  }

  const amountCents = Number(args.amount) / 10_000;
  const feeCents = Number(args.fee) / 10_000;

  // Derive chain/token from the subscription's initial payment (falling back
  // to schema defaults) rather than hardcoding "base"/"USDC".
  let chain = "base";
  let token = "USDC";
  if (subscription.lastPaymentId) {
    const [prior] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, subscription.lastPaymentId))
      .limit(1);
    if (prior) {
      chain = prior.chain;
      token = prior.token;
    }
  }

  // Create payment record for recurring charge
  const [payment] = await db
    .insert(payments)
    .values({
      productId: subscription.productId,
      userId: subscription.userId,
      customerId: subscription.customerId,
      amount: amountCents,
      fee: feeCents,
      status: "confirmed",
      txHash: log.transactionHash,
      chain,
      token,
      fromAddress: args.subscriber,
      toAddress: args.merchant,
      blockNumber: log.blockNumber ? Number(log.blockNumber) : null,
    })
    .returning();

  console.log(`[Handler] Created recurring subscription payment ${payment.id}`);

  // Update subscription: advance nextChargeDate by interval
  // We compute the new nextChargeDate from the existing one if possible (so
  // schedules don't drift), else from now.
  const base = subscription.nextChargeDate
    ? new Date(subscription.nextChargeDate)
    : new Date();
  // We need the interval; read from the previous period length if available.
  const periodMs =
    subscription.currentPeriodEnd && subscription.currentPeriodStart
      ? new Date(subscription.currentPeriodEnd).getTime() -
        new Date(subscription.currentPeriodStart).getTime()
      : 0;

  const nextCharge =
    periodMs > 0
      ? new Date(base.getTime() + periodMs)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db
    .update(subscriptions)
    .set({
      status: "active",
      currentPeriodStart: base,
      currentPeriodEnd: nextCharge,
      nextChargeDate: nextCharge,
      lastPaymentId: payment.id,
    })
    .where(eq(subscriptions.id, subscription.id));

  console.log(
    `[Handler] Subscription ${subscription.id} advanced to next charge ${nextCharge.toISOString()}`
  );

  await dispatchWebhooks(subscription.userId, "subscription.charged", {
    subscriptionId: subscription.id,
    onChainId,
    paymentId: payment.id,
    amount: amountCents,
    fee: feeCents,
    txHash: log.transactionHash,
    nextChargeDate: nextCharge.toISOString(),
    metadata: subscription.metadata ?? {},
  });
}

export async function handleSubscriptionPastDue(log: Log, args: {
  subscriptionId: bigint;
}) {
  console.log("[Handler] SubscriptionPastDue:", {
    txHash: log.transactionHash,
    subscriptionId: args.subscriptionId.toString(),
  });

  const onChainId = args.subscriptionId.toString();

  const [updated] = await db
    .update(subscriptions)
    .set({ status: "past_due" })
    .where(eq(subscriptions.onChainId, onChainId))
    .returning();

  if (updated) {
    console.log(`[Handler] Subscription ${updated.id} marked past_due`);
    await dispatchWebhooks(updated.userId, "subscription.past_due", {
      subscriptionId: updated.id,
      onChainId,
      status: "past_due",
      metadata: updated.metadata ?? {},
    });
  }
}

export async function handleSubscriptionCancelled(log: Log, args: {
  subscriptionId: bigint;
}) {
  console.log("[Handler] SubscriptionCancelled:", {
    txHash: log.transactionHash,
    subscriptionId: args.subscriptionId.toString(),
  });

  const onChainId = args.subscriptionId.toString();

  const [updated] = await db
    .update(subscriptions)
    .set({ status: "cancelled" })
    .where(eq(subscriptions.onChainId, onChainId))
    .returning();

  if (updated) {
    console.log(`[Handler] Subscription ${updated.id} cancelled`);
    await dispatchWebhooks(updated.userId, "subscription.cancelled", {
      subscriptionId: updated.id,
      onChainId,
      status: "cancelled",
      metadata: updated.metadata ?? {},
    });
  }
}

function rehydrateLog(row: typeof unmatchedEvents.$inferSelect): Log {
  return {
    address: "0x0000000000000000000000000000000000000000",
    blockHash: null,
    blockNumber: row.blockNumber !== null ? BigInt(row.blockNumber) : null,
    data: "0x",
    logIndex: row.logIndex ?? null,
    removed: false,
    topics: [],
    transactionHash: row.txHash as `0x${string}`,
    transactionIndex: null,
  } as unknown as Log;
}

function rehydratePaymentArgs(payload: Record<string, unknown>) {
  return {
    payer: payload.payer as `0x${string}`,
    merchant: payload.merchant as `0x${string}`,
    token: payload.token as `0x${string}`,
    amount: BigInt(payload.amount as string),
    fee: BigInt(payload.fee as string),
    productId: payload.productId as `0x${string}`,
    customerId: payload.customerId as `0x${string}`,
    timestamp: BigInt(payload.timestamp as string),
  };
}

function rehydrateSubCreatedArgs(payload: Record<string, unknown>) {
  return {
    subscriptionId: BigInt(payload.subscriptionId as string),
    subscriber: payload.subscriber as `0x${string}`,
    merchant: payload.merchant as `0x${string}`,
    token: payload.token as `0x${string}`,
    amount: BigInt(payload.amount as string),
    interval: BigInt(payload.interval as string),
    productId: payload.productId as `0x${string}`,
    customerId: payload.customerId as `0x${string}`,
  };
}

export async function retryUnmatchedEvents() {
  const rows = await db
    .select()
    .from(unmatchedEvents)
    .orderBy(desc(unmatchedEvents.createdAt))
    .limit(50);

  if (rows.length === 0) return;

  console.log(`[Handler] Retrying ${rows.length} unmatched events`);

  for (const row of rows) {
    try {
      const log = rehydrateLog(row);
      const payload = row.payload as Record<string, unknown>;

      if (row.eventType === "PaymentReceived") {
        // Delete first to avoid the handler re-recording itself as unmatched,
        // then attempt. On failure, re-record is fine because txHash
        // idempotency protects us.
        await db
          .delete(unmatchedEvents)
          .where(eq(unmatchedEvents.id, row.id));
        await handlePaymentReceived(log, rehydratePaymentArgs(payload));
      } else if (row.eventType === "SubscriptionCreated") {
        await db
          .delete(unmatchedEvents)
          .where(eq(unmatchedEvents.id, row.id));
        await handleSubscriptionCreated(log, rehydrateSubCreatedArgs(payload));
      } else {
        // Unknown type: just bump attempts
        await db
          .update(unmatchedEvents)
          .set({ attempts: row.attempts + 1 })
          .where(eq(unmatchedEvents.id, row.id));
      }
    } catch (err) {
      console.error(
        `[Handler] Failed retrying unmatched event ${row.id}:`,
        err
      );
    }
  }
}
