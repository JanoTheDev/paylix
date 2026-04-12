import { createDb } from "@paylix/db/client";
import {
  payments,
  subscriptions,
  checkoutSessions,
  customers,
  unmatchedEvents,
  products,
  merchantProfiles,
  invoices,
  invoiceLineItems,
} from "@paylix/db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { keccak256, stringToBytes, type Log } from "viem";
import { NETWORKS, getToken } from "@paylix/config/networks";
import type { NetworkKey } from "@paylix/config/networks";
import { config } from "./config";
import { dispatchWebhooks } from "./webhook-dispatch";
import { buildInvoice } from "./invoices/create";
import { sendInvoiceEmail } from "./invoices/send-email";

function currentSubscriptionManagerAddress(): string {
  return config.subscriptionManagerAddress.toLowerCase();
}

/**
 * Reverse-lookup: given a network and a token address, find the symbol.
 * Used when populating new session/subscription rows from PaymentReceived
 * events that only carry the token's 0x address.
 */
function symbolForTokenAddress(
  networkKey: NetworkKey,
  address: `0x${string}`,
): string {
  const network = NETWORKS[networkKey];
  const lower = address.toLowerCase();
  for (const [symbol, token] of Object.entries(network.tokens)) {
    const resolved = (
      token.address ?? process.env[(token as { addressEnvVar?: string }).addressEnvVar ?? ""] ?? ""
    ).toLowerCase();
    if (resolved === lower) return symbol;
  }
  throw new Error(
    `Token address ${address} is not registered on ${networkKey}`,
  );
}

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

  // Convert on-chain amount back to cents using registry decimals.
  // Formula: cents = on_chain / 10^(decimals - 2)
  // For USDC (decimals=6): 10^4 = 10,000 → 1,000,000 units = 100 cents.
  const paymentToken = getToken(config.networkKey, symbolForTokenAddress(config.networkKey as NetworkKey, args.token));
  const amountCents = Number(args.amount) / 10 ** (paymentToken.decimals - 2);

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

  // Perform all writes atomically. A crash mid-handler must not leave
  // partial state (half-upserted customer, orphaned payment, unlinked
  // checkout session). Webhook dispatch stays OUTSIDE the transaction.
  const result = await db.transaction(async (tx) => {
    // Create or find customer record
    const customerIdentifier = session.customerId || `anon_${args.payer}`;
    let [customer] = await tx
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, session.organizationId),
          eq(customers.customerId, customerIdentifier)
        )
      );

    if (!customer) {
      const [created] = await tx
        .insert(customers)
        .values({
          organizationId: session.organizationId,
          customerId: customerIdentifier,
          walletAddress: args.payer,
          country: session.buyerCountry,
          taxId: session.buyerTaxId,
          firstName: session.buyerFirstName,
          lastName: session.buyerLastName,
          email: session.buyerEmail,
          phone: session.buyerPhone,
        })
        .returning();
      customer = created;
      console.log(`[Handler] Created customer ${customer.id}`);
    } else {
      const patch: Record<string, string | null> = {};
      if (!customer.walletAddress) patch.walletAddress = args.payer;
      if (session.buyerCountry && !customer.country) patch.country = session.buyerCountry;
      if (session.buyerTaxId && !customer.taxId) patch.taxId = session.buyerTaxId;
      if (session.buyerFirstName && !customer.firstName) patch.firstName = session.buyerFirstName;
      if (session.buyerLastName && !customer.lastName) patch.lastName = session.buyerLastName;
      if (session.buyerEmail && !customer.email) patch.email = session.buyerEmail;
      if (session.buyerPhone && !customer.phone) patch.phone = session.buyerPhone;
      if (Object.keys(patch).length > 0) {
        const [updated] = await tx
          .update(customers)
          .set(patch)
          .where(eq(customers.id, customer.id))
          .returning();
        customer = updated;
      }
    }

    // Create payment record
    const sessionNetworkKey = session.networkKey ?? config.networkKey;
    const sessionTokenSymbol = session.tokenSymbol ?? symbolForTokenAddress(config.networkKey as NetworkKey, args.token);
    const [payment] = await tx
      .insert(payments)
      .values({
        productId: session.productId,
        organizationId: session.organizationId,
        customerId: customer.id,
        amount: amountCents,
        fee: Number(args.fee) / 10_000,
        status: "confirmed",
        txHash: log.transactionHash,
        chain: sessionNetworkKey,
        token: sessionTokenSymbol,
        fromAddress: args.payer,
        toAddress: args.merchant,
        blockNumber: log.blockNumber ? Number(log.blockNumber) : null,
      })
      .returning();

    console.log(`[Handler] Created payment ${payment.id}`);

    // Update checkout session to completed
    await tx
      .update(checkoutSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        paymentId: payment.id,
      })
      .where(eq(checkoutSessions.id, session.id));

    console.log(`[Handler] Checkout session ${session.id} marked completed`);

    // Load product (for tax fields) + merchant profile (for snapshot).
    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.id, session.productId))
      .limit(1);
    if (!product) throw new Error(`Product ${session.productId} not found`);

    // Upsert a blank profile if none exists so we always have a row to
    // atomically increment invoiceSequence against.
    await tx
      .insert(merchantProfiles)
      .values({ organizationId: session.organizationId })
      .onConflictDoNothing({ target: merchantProfiles.organizationId });

    const [profile] = await tx
      .select()
      .from(merchantProfiles)
      .where(eq(merchantProfiles.organizationId, session.organizationId))
      .limit(1);
    if (!profile) throw new Error("merchant_profiles row missing after upsert");

    const built = buildInvoice({
      profile: {
        organizationId: profile.organizationId,
        legalName: profile.legalName,
        addressLine1: profile.addressLine1,
        addressLine2: profile.addressLine2,
        city: profile.city,
        postalCode: profile.postalCode,
        country: profile.country,
        taxId: profile.taxId,
        supportEmail: profile.supportEmail,
        logoUrl: profile.logoUrl,
        invoicePrefix: profile.invoicePrefix,
        invoiceFooter: profile.invoiceFooter,
        invoiceSequence: profile.invoiceSequence,
      },
      product: {
        id: product.id,
        name: product.name,
        taxRateBps: product.taxRateBps,
        taxLabel: product.taxLabel,
        reverseChargeEligible: product.reverseChargeEligible,
      },
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        country: customer.country,
        taxId: customer.taxId,
      },
      payment: { id: payment.id, amount: payment.amount },
    });

    await tx
      .update(merchantProfiles)
      .set({ invoiceSequence: built.nextSequence })
      .where(eq(merchantProfiles.organizationId, session.organizationId));

    // If merchant has not filled their profile, mark the email as skipped —
    // we still create the invoice so numbering stays sequential.
    const hasProfile =
      profile.legalName.trim().length > 0 &&
      profile.supportEmail.trim().length > 0;

    const [invoice] = await tx
      .insert(invoices)
      .values({
        ...built.invoice,
        emailStatus: hasProfile ? "pending" : "skipped",
      })
      .returning();

    await tx.insert(invoiceLineItems).values(
      built.lineItems.map((li) => ({
        invoiceId: invoice.id,
        description: li.description,
        quantity: li.quantity,
        unitAmountCents: li.unitAmountCents,
        amountCents: li.amountCents,
      })),
    );

    return { customer, payment, invoice, emailable: hasProfile };
  });

  // Dispatch webhook AFTER the tx commits — webhook HTTP calls can be slow
  // and must not hold a DB transaction open.
  await dispatchWebhooks(session.organizationId, "payment.confirmed", {
    paymentId: result.payment.id,
    checkoutId: session.id,
    productId: session.productId,
    customerId: result.customer.customerId,
    amount: result.payment.amount,
    fee: result.payment.fee,
    currency: result.payment.token,
    chain: result.payment.chain,
    txHash: log.transactionHash,
    fromAddress: args.payer,
    toAddress: args.merchant,
    metadata: session.metadata ?? {},
  });
  await dispatchWebhooks(session.organizationId, "invoice.issued", {
    invoiceId: result.invoice.id,
    number: result.invoice.number,
    paymentId: result.payment.id,
    customerId: result.customer.customerId,
    totalCents: result.invoice.totalCents,
    currency: result.invoice.currency,
    hostedUrl: `/i/${result.invoice.hostedToken}`,
  });
  if (result.emailable) {
    await sendInvoiceEmail({
      invoiceId: result.invoice.id,
      organizationId: session.organizationId,
    }).catch((err) => {
      console.error("[Handler] sendInvoiceEmail failed:", err);
    });
  }
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
  const contractAddr = currentSubscriptionManagerAddress();
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.onChainId, onChainId),
        eq(subscriptions.contractAddress, contractAddr),
      )
    )
    .limit(1);

  if (existing) {
    console.log(`[Handler] Subscription ${onChainId} already exists, skipping`);
    return;
  }

  // Trial activation path: try to match a pending trialing row first.
  // If found, UPDATE it in place instead of creating a new row. This is the
  // completion of the "off-chain trial -> on-chain subscription" handshake
  // kicked off by the trial converter keeper loop.
  const trialRows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "trialing"),
        sql`lower(${subscriptions.subscriberAddress}) = lower(${args.subscriber})`,
        sql`lower(${subscriptions.contractAddress}) = lower(${contractAddr})`,
        sql`${subscriptions.pendingPermitSignature}->'intent'->>'amount' = ${args.amount.toString()}`,
        sql`(${subscriptions.pendingPermitSignature}->'intent'->>'interval')::bigint = ${args.interval}::bigint`,
      ),
    )
    .orderBy(subscriptions.trialEndsAt)
    .limit(1);

  if (trialRows.length > 0) {
    const trialRow = trialRows[0];
    const trialIntervalSeconds = Number(args.interval);
    const now = new Date();
    const nextCharge = new Date(now.getTime() + trialIntervalSeconds * 1000);

    await db
      .update(subscriptions)
      .set({
        status: "active",
        onChainId,
        currentPeriodStart: now,
        currentPeriodEnd: nextCharge,
        nextChargeDate: nextCharge,
        pendingPermitSignature: null,
        trialConversionLastError: null,
        intervalSeconds: trialIntervalSeconds,
      })
      .where(eq(subscriptions.id, trialRow.id));

    console.log(`[Handler] Activated trial subscription ${trialRow.id} (onChainId: ${onChainId})`);

    // TODO(trial-first-payment): also insert the first payments/invoice row
    // here so the trial-converted subscription's initial charge is visible in
    // the dashboard the same way non-trial subscriptions are. Skipped in this
    // task to avoid duplicating the existing checkout-session-match path
    // (which depends on a matching checkout_session row that trialing rows
    // don't necessarily have).
    await dispatchWebhooks(trialRow.organizationId, "subscription.trial_converted", {
      subscriptionId: trialRow.id,
      onChainId,
      subscriberAddress: args.subscriber,
      merchantAddress: args.merchant,
      txHash: log.transactionHash,
    });
    return;
  }

  const subToken = getToken(config.networkKey, symbolForTokenAddress(config.networkKey as NetworkKey, args.token));
  const amountCents = Number(args.amount) / 10 ** (subToken.decimals - 2);
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

  // Atomic: customer upsert + initial payment + subscription row +
  // checkout session completion. Webhook dispatch stays OUTSIDE.
  const result = await db.transaction(async (tx) => {
    // Create or find customer
    const customerIdentifier = session.customerId || `anon_${args.subscriber}`;
    let [customer] = await tx
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, session.organizationId),
          eq(customers.customerId, customerIdentifier)
        )
      );

    if (!customer) {
      const [created] = await tx
        .insert(customers)
        .values({
          organizationId: session.organizationId,
          customerId: customerIdentifier,
          walletAddress: args.subscriber,
          country: session.buyerCountry,
          taxId: session.buyerTaxId,
          firstName: session.buyerFirstName,
          lastName: session.buyerLastName,
          email: session.buyerEmail,
          phone: session.buyerPhone,
        })
        .returning();
      customer = created;
      console.log(`[Handler] Created customer ${customer.id}`);
    } else {
      const patch: Record<string, string | null> = {};
      if (!customer.walletAddress) patch.walletAddress = args.subscriber;
      if (session.buyerCountry && !customer.country) patch.country = session.buyerCountry;
      if (session.buyerTaxId && !customer.taxId) patch.taxId = session.buyerTaxId;
      if (session.buyerFirstName && !customer.firstName) patch.firstName = session.buyerFirstName;
      if (session.buyerLastName && !customer.lastName) patch.lastName = session.buyerLastName;
      if (session.buyerEmail && !customer.email) patch.email = session.buyerEmail;
      if (session.buyerPhone && !customer.phone) patch.phone = session.buyerPhone;
      if (Object.keys(patch).length > 0) {
        const [updated] = await tx
          .update(customers)
          .set(patch)
          .where(eq(customers.id, customer.id))
          .returning();
        customer = updated;
      }
    }

    // Create first payment (the initial charge happens atomically with createSubscription)
    const subNetworkKey = session.networkKey ?? config.networkKey;
    const subTokenSymbol = session.tokenSymbol ?? symbolForTokenAddress(config.networkKey as NetworkKey, args.token);
    const [payment] = await tx
      .insert(payments)
      .values({
        productId: session.productId,
        organizationId: session.organizationId,
        customerId: customer.id,
        amount: amountCents,
        fee: 0, // fee is tracked per-charge in PaymentReceived; creation doesn't include it here
        status: "confirmed",
        txHash: log.transactionHash,
        chain: subNetworkKey,
        token: subTokenSymbol,
        fromAddress: args.subscriber,
        toAddress: args.merchant,
        blockNumber: log.blockNumber ? Number(log.blockNumber) : null,
      })
      .returning();

    console.log(`[Handler] Created initial subscription payment ${payment.id}`);

    // Load product + merchant profile for invoice snapshot.
    const [subProduct] = await tx
      .select()
      .from(products)
      .where(eq(products.id, session.productId))
      .limit(1);
    if (!subProduct) throw new Error(`Product ${session.productId} not found`);

    await tx
      .insert(merchantProfiles)
      .values({ organizationId: session.organizationId })
      .onConflictDoNothing({ target: merchantProfiles.organizationId });

    const [subProfile] = await tx
      .select()
      .from(merchantProfiles)
      .where(eq(merchantProfiles.organizationId, session.organizationId))
      .limit(1);
    if (!subProfile) throw new Error("merchant_profiles row missing after upsert");

    const subBuilt = buildInvoice({
      profile: {
        organizationId: subProfile.organizationId,
        legalName: subProfile.legalName,
        addressLine1: subProfile.addressLine1,
        addressLine2: subProfile.addressLine2,
        city: subProfile.city,
        postalCode: subProfile.postalCode,
        country: subProfile.country,
        taxId: subProfile.taxId,
        supportEmail: subProfile.supportEmail,
        logoUrl: subProfile.logoUrl,
        invoicePrefix: subProfile.invoicePrefix,
        invoiceFooter: subProfile.invoiceFooter,
        invoiceSequence: subProfile.invoiceSequence,
      },
      product: {
        id: subProduct.id,
        name: subProduct.name,
        taxRateBps: subProduct.taxRateBps,
        taxLabel: subProduct.taxLabel,
        reverseChargeEligible: subProduct.reverseChargeEligible,
      },
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        country: customer.country,
        taxId: customer.taxId,
      },
      payment: { id: payment.id, amount: payment.amount },
    });

    await tx
      .update(merchantProfiles)
      .set({ invoiceSequence: subBuilt.nextSequence })
      .where(eq(merchantProfiles.organizationId, session.organizationId));

    const subHasProfile =
      subProfile.legalName.trim().length > 0 &&
      subProfile.supportEmail.trim().length > 0;

    const [subInvoice] = await tx
      .insert(invoices)
      .values({
        ...subBuilt.invoice,
        emailStatus: subHasProfile ? "pending" : "skipped",
      })
      .returning();

    await tx.insert(invoiceLineItems).values(
      subBuilt.lineItems.map((li) => ({
        invoiceId: subInvoice.id,
        description: li.description,
        quantity: li.quantity,
        unitAmountCents: li.unitAmountCents,
        amountCents: li.amountCents,
      })),
    );

    const now = new Date();
    const nextCharge = new Date(now.getTime() + intervalSeconds * 1000);

    // Create subscription row
    const [subscription] = await tx
      .insert(subscriptions)
      .values({
        productId: session.productId,
        organizationId: session.organizationId,
        customerId: customer.id,
        subscriberAddress: args.subscriber,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: nextCharge,
        nextChargeDate: nextCharge,
        lastPaymentId: payment.id,
        onChainId,
        contractAddress: contractAddr,
        networkKey: subNetworkKey,
        tokenSymbol: subTokenSymbol,
        intervalSeconds,
        metadata: session.metadata ?? {},
      })
      .returning();

    console.log(`[Handler] Created subscription ${subscription.id} (onChainId: ${onChainId})`);

    // Mark checkout session completed and link to subscription
    await tx
      .update(checkoutSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        paymentId: payment.id,
      })
      .where(eq(checkoutSessions.id, session.id));

    console.log(`[Handler] Checkout session ${session.id} marked completed`);

    return { customer, payment, subscription, invoice: subInvoice, emailable: subHasProfile };
  });

  // Dispatch webhook AFTER the tx commits.
  await dispatchWebhooks(session.organizationId, "subscription.created", {
    subscriptionId: result.subscription.id,
    onChainId,
    checkoutId: session.id,
    productId: session.productId,
    customerId: result.customer.customerId,
    amount: amountCents,
    currency: result.subscription.tokenSymbol,
    chain: result.subscription.networkKey,
    interval: intervalSeconds,
    subscriberAddress: args.subscriber,
    merchantAddress: args.merchant,
    txHash: log.transactionHash,
    metadata: result.subscription.metadata ?? {},
  });
  await dispatchWebhooks(session.organizationId, "invoice.issued", {
    invoiceId: result.invoice.id,
    number: result.invoice.number,
    paymentId: result.payment.id,
    subscriptionId: result.subscription.id,
    customerId: result.customer.customerId,
    totalCents: result.invoice.totalCents,
    currency: result.invoice.currency,
    hostedUrl: `/i/${result.invoice.hostedToken}`,
  });
  if (result.emailable) {
    await sendInvoiceEmail({
      invoiceId: result.invoice.id,
      organizationId: session.organizationId,
    }).catch((err) => {
      console.error("[Handler] sendInvoiceEmail failed:", err);
    });
  }
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

  const contractAddr = currentSubscriptionManagerAddress();
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.onChainId, onChainId),
        eq(subscriptions.contractAddress, contractAddr),
      )
    )
    .limit(1);

  if (!subscription) {
    // Subscription not yet created — could be a race with handleSubscriptionCreated
    // (especially for trial conversions where the same tx emits both events).
    // Record as unmatched so the retry queue catches up once activation completes.
    console.log(
      `[Handler] No subscription found for onChainId=${onChainId}; recording unmatched for retry.`,
    );
    await recordUnmatched("SubscriptionPaymentReceived", log, serializeArgs(args));
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

  const recurringToken = getToken(subscription.networkKey as NetworkKey, subscription.tokenSymbol);
  const amountCents = Number(args.amount) / 10 ** (recurringToken.decimals - 2);
  const feeCents = Number(args.fee) / 10 ** (recurringToken.decimals - 2);

  // Atomic: insert recurring payment + advance subscription period.
  // Webhook dispatch stays OUTSIDE the transaction.
  const result = await db.transaction(async (tx) => {
    // Read chain/token from the subscription row (populated at subscription
    // creation time). This avoids the N+1 query of the prior-payment lookup.
    const chain = subscription.networkKey;
    const token = subscription.tokenSymbol;

    // Create payment record for recurring charge
    const [payment] = await tx
      .insert(payments)
      .values({
        productId: subscription.productId,
        organizationId: subscription.organizationId,
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

    // Load product and customer for invoice snapshot.
    const [recurringProduct] = await tx
      .select()
      .from(products)
      .where(eq(products.id, subscription.productId))
      .limit(1);
    if (!recurringProduct) throw new Error(`Product ${subscription.productId} not found`);

    const [customerRow] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, subscription.customerId))
      .limit(1);
    if (!customerRow) throw new Error(`Customer ${subscription.customerId} not found`);

    await tx
      .insert(merchantProfiles)
      .values({ organizationId: subscription.organizationId })
      .onConflictDoNothing({ target: merchantProfiles.organizationId });

    const [recurringProfile] = await tx
      .select()
      .from(merchantProfiles)
      .where(eq(merchantProfiles.organizationId, subscription.organizationId))
      .limit(1);
    if (!recurringProfile) throw new Error("merchant_profiles row missing after upsert");

    const recurringBuilt = buildInvoice({
      profile: {
        organizationId: recurringProfile.organizationId,
        legalName: recurringProfile.legalName,
        addressLine1: recurringProfile.addressLine1,
        addressLine2: recurringProfile.addressLine2,
        city: recurringProfile.city,
        postalCode: recurringProfile.postalCode,
        country: recurringProfile.country,
        taxId: recurringProfile.taxId,
        supportEmail: recurringProfile.supportEmail,
        logoUrl: recurringProfile.logoUrl,
        invoicePrefix: recurringProfile.invoicePrefix,
        invoiceFooter: recurringProfile.invoiceFooter,
        invoiceSequence: recurringProfile.invoiceSequence,
      },
      product: {
        id: recurringProduct.id,
        name: recurringProduct.name,
        taxRateBps: recurringProduct.taxRateBps,
        taxLabel: recurringProduct.taxLabel,
        reverseChargeEligible: recurringProduct.reverseChargeEligible,
      },
      customer: {
        id: customerRow.id,
        firstName: customerRow.firstName,
        lastName: customerRow.lastName,
        email: customerRow.email,
        country: customerRow.country,
        taxId: customerRow.taxId,
      },
      payment: { id: payment.id, amount: payment.amount },
    });

    await tx
      .update(merchantProfiles)
      .set({ invoiceSequence: recurringBuilt.nextSequence })
      .where(eq(merchantProfiles.organizationId, subscription.organizationId));

    const recurringHasProfile =
      recurringProfile.legalName.trim().length > 0 &&
      recurringProfile.supportEmail.trim().length > 0;

    const [recurringInvoice] = await tx
      .insert(invoices)
      .values({
        ...recurringBuilt.invoice,
        emailStatus: recurringHasProfile ? "pending" : "skipped",
      })
      .returning();

    await tx.insert(invoiceLineItems).values(
      recurringBuilt.lineItems.map((li) => ({
        invoiceId: recurringInvoice.id,
        description: li.description,
        quantity: li.quantity,
        unitAmountCents: li.unitAmountCents,
        amountCents: li.amountCents,
      })),
    );

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

    await tx
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

    return { payment, nextCharge, invoice: recurringInvoice, emailable: recurringHasProfile };
  });

  await dispatchWebhooks(subscription.organizationId, "subscription.charged", {
    subscriptionId: subscription.id,
    onChainId,
    paymentId: result.payment.id,
    amount: amountCents,
    fee: feeCents,
    txHash: log.transactionHash,
    nextChargeDate: result.nextCharge.toISOString(),
    metadata: subscription.metadata ?? {},
  });
  await dispatchWebhooks(subscription.organizationId, "invoice.issued", {
    invoiceId: result.invoice.id,
    number: result.invoice.number,
    paymentId: result.payment.id,
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    totalCents: result.invoice.totalCents,
    currency: result.invoice.currency,
    hostedUrl: `/i/${result.invoice.hostedToken}`,
  });
  if (result.emailable) {
    await sendInvoiceEmail({
      invoiceId: result.invoice.id,
      organizationId: subscription.organizationId,
    }).catch((err) => {
      console.error("[Handler] sendInvoiceEmail failed:", err);
    });
  }
}

export async function handleSubscriptionPastDue(log: Log, args: {
  subscriptionId: bigint;
}) {
  console.log("[Handler] SubscriptionPastDue:", {
    txHash: log.transactionHash,
    subscriptionId: args.subscriptionId.toString(),
  });

  const onChainId = args.subscriptionId.toString();
  const contractAddr = currentSubscriptionManagerAddress();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(subscriptions)
      .set({ status: "past_due" })
      .where(
        and(
          eq(subscriptions.onChainId, onChainId),
          eq(subscriptions.contractAddress, contractAddr),
        )
      )
      .returning();
    return row ?? null;
  });

  if (updated) {
    console.log(`[Handler] Subscription ${updated.id} marked past_due`);
    await dispatchWebhooks(updated.organizationId, "subscription.past_due", {
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
  const contractAddr = currentSubscriptionManagerAddress();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(subscriptions)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(subscriptions.onChainId, onChainId),
          eq(subscriptions.contractAddress, contractAddr),
        )
      )
      .returning();
    return row ?? null;
  });

  if (updated) {
    console.log(`[Handler] Subscription ${updated.id} cancelled`);
    await dispatchWebhooks(updated.organizationId, "subscription.cancelled", {
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

function rehydrateSubPaymentReceivedArgs(payload: Record<string, unknown>) {
  return {
    subscriptionId: BigInt(payload.subscriptionId as string),
    subscriber: payload.subscriber as `0x${string}`,
    merchant: payload.merchant as `0x${string}`,
    token: payload.token as `0x${string}`,
    amount: BigInt(payload.amount as string),
    fee: BigInt(payload.fee as string),
    timestamp: BigInt(payload.timestamp as string),
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
      } else if (row.eventType === "SubscriptionPaymentReceived") {
        await db
          .delete(unmatchedEvents)
          .where(eq(unmatchedEvents.id, row.id));
        await handleSubscriptionPaymentReceived(
          log,
          rehydrateSubPaymentReceivedArgs(payload),
        );
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
