import { createElement } from "react";
import { eq } from "drizzle-orm";
import { sendMail } from "@paylix/mailer";
import { createDb } from "@paylix/db/client";
import { subscriptions, products, customers, payments } from "@paylix/db/schema";
import { getToken, type NetworkKey } from "@paylix/config/networks";
import { config } from "../config";
import type { TrialConversionFailureReason } from "./trial-conversion-failed";
import { isNotificationEnabled } from "./notifications-enabled";
import type { NotificationKind } from "@paylix/db/schema";

function kindToNotification(
  kind: SendTrialEmailArgs["kind"],
): NotificationKind {
  switch (kind) {
    case "trial-started":
      return "trialStarted";
    case "trial-ending-soon":
      return "trialEndingSoon";
    case "trial-converted":
      return "trialConverted";
    case "trial-conversion-failed":
      return "trialFailed";
  }
}

export type SendTrialEmailArgs =
  | { kind: "trial-started"; subscriptionId: string }
  | { kind: "trial-ending-soon"; subscriptionId: string }
  | { kind: "trial-converted"; subscriptionId: string; paymentId: string }
  | {
      kind: "trial-conversion-failed";
      subscriptionId: string;
      reason: string;
    };

const db = createDb(config.databaseUrl);

function formatAmount(rawAmount: string, networkKey: string, tokenSymbol: string): string {
  try {
    const token = getToken(networkKey as NetworkKey, tokenSymbol);
    const decimals = token.decimals;
    const raw = BigInt(rawAmount);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const frac = raw % base;
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    const amountStr = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
    return `${amountStr} ${tokenSymbol}`;
  } catch {
    return `${rawAmount} ${tokenSymbol}`;
  }
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function daysUntil(target: Date): number {
  const ms = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function normalizeReason(reason: string): TrialConversionFailureReason {
  switch (reason) {
    case "insufficient_balance":
    case "allowance_revoked":
    case "permit_expired":
    case "nonce_drift":
      return reason;
    default:
      return "unknown";
  }
}

export async function sendTrialEmail(args: SendTrialEmailArgs): Promise<void> {
  try {
    const [row] = await db
      .select({
        subscription: subscriptions,
        product: products,
        customer: customers,
      })
      .from(subscriptions)
      .innerJoin(products, eq(products.id, subscriptions.productId))
      .innerJoin(customers, eq(customers.id, subscriptions.customerId))
      .where(eq(subscriptions.id, args.subscriptionId))
      .limit(1);

    if (!row) {
      console.warn("[sendTrialEmail] subscription not found:", args.subscriptionId);
      return;
    }

    const { subscription, product, customer } = row;
    if (!customer.email) {
      console.log("[sendTrialEmail] customer has no email, skipping:", args.subscriptionId);
      return;
    }

    const { loadEmailBranding } = await import("./load-branding");
    const branding = await loadEmailBranding(subscription.organizationId);

    if (
      !(await isNotificationEnabled(
        subscription.organizationId,
        kindToNotification(args.kind),
      ))
    ) {
      console.log(
        `[sendTrialEmail] notifications disabled, skipping ${args.kind} for ${args.subscriptionId}`,
      );
      return;
    }

    // Per-customer opt-out check. Trial reminders map to the
    // trial_reminders category; the trial-converted receipt is a
    // transactional email and falls under receipts.
    const { customerOptedIn } = await import("./customer-prefs");
    const customerCategory =
      args.kind === "trial-ending-soon"
        ? "trial_reminders"
        : args.kind === "trial-converted"
          ? "receipts"
          : null;
    if (customerCategory) {
      const optedIn = await customerOptedIn(customer.id, customerCategory);
      if (!optedIn) {
        console.log(
          `[sendTrialEmail] customer opted out of ${customerCategory}, skipping ${args.kind}`,
        );
        return;
      }
    }

    const productName = product.name;
    const trialEndsAt = subscription.trialEndsAt ?? new Date();
    const firstChargeDate = formatDate(trialEndsAt);

    let amountLabel = `${subscription.tokenSymbol}`;
    const sig = subscription.pendingPermitSignature;
    if (sig) {
      amountLabel = formatAmount(
        sig.priceSnapshot.amount,
        sig.priceSnapshot.networkKey,
        sig.priceSnapshot.tokenSymbol,
      );
    }

    let subject: string;
    let react;

    if (args.kind === "trial-started") {
      const { TrialStartedEmail } = await import("./trial-started");
      const trialLabel = firstChargeDate;
      subject = `Your trial of ${productName} has started`;
      react = createElement(TrialStartedEmail, {
        productName,
        trialLabel,
        amountLabel,
        firstChargeDate,
        branding,
      });
    } else if (args.kind === "trial-ending-soon") {
      const { TrialEndingSoonEmail } = await import("./trial-ending-soon");
      const daysLeft = daysUntil(trialEndsAt);
      subject = `Your trial of ${productName} ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
      react = createElement(TrialEndingSoonEmail, {
        productName,
        daysLeft,
        amountLabel,
        firstChargeDate,
        branding,
      });
    } else if (args.kind === "trial-converted") {
      const { TrialConvertedEmail } = await import("./trial-converted");
      const [paymentRow] = await db
        .select({
          amount: payments.amount,
          txHash: payments.txHash,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .where(eq(payments.id, args.paymentId))
        .limit(1);

      // Receipt charge shows the paid amount using the subscription's token
      // (cents are stored scaled already on the payment row for subscriptions).
      const chargeAmount = paymentRow
        ? `${(paymentRow.amount / 100).toFixed(2)} ${subscription.tokenSymbol}`
        : amountLabel;
      const chargeDate = formatDate(paymentRow?.createdAt ?? new Date());
      const nextChargeDate = subscription.nextChargeDate
        ? formatDate(new Date(subscription.nextChargeDate))
        : null;

      subject = `Your ${productName} subscription is active`;
      react = createElement(TrialConvertedEmail, {
        productName,
        amountLabel: chargeAmount,
        chargeDate,
        nextChargeDate,
        txHash: paymentRow?.txHash ?? null,
        branding,
      });
    } else {
      const { TrialConversionFailedEmail } = await import("./trial-conversion-failed");
      // TODO: replace with a real customer-portal restart URL once that route exists.
      const restartUrl = `${config.publicAppUrl}/subscriptions/${subscription.id}/restart`;
      subject = `We couldn't start your subscription to ${productName}`;
      react = createElement(TrialConversionFailedEmail, {
        productName,
        reason: normalizeReason(args.reason),
        restartUrl,
        branding,
      });
    }

    const result = await sendMail({
      to: customer.email,
      from: config.defaultFromEmail,
      subject,
      react,
    });

    if (result.ok) {
      console.log(`[sendTrialEmail] sent ${args.kind} for ${args.subscriptionId}`);
    } else {
      console.error(
        `[sendTrialEmail] failed ${args.kind} for ${args.subscriptionId}:`,
        result.error,
      );
    }
  } catch (err) {
    console.error("[sendTrialEmail] unexpected error:", err);
  }
}
