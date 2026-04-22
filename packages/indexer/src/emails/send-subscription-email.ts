import { createElement } from "react";
import { eq } from "drizzle-orm";
import { sendMail } from "@paylix/mailer";
import { createDb } from "@paylix/db/client";
import { subscriptions, products, customers, payments } from "@paylix/db/schema";
import { config } from "../config";
import { isNotificationEnabled } from "./notifications-enabled";
import type { NotificationKind } from "@paylix/db/schema";

function kindToNotification(
  kind: SendSubscriptionEmailArgs["kind"],
): NotificationKind {
  switch (kind) {
    case "subscription-created":
      return "subscriptionCreated";
    case "subscription-cancelled":
      return "subscriptionCancelled";
    case "payment-receipt":
      return "paymentReceipt";
    case "past-due-reminder":
      return "pastDue";
  }
}

export type SendSubscriptionEmailArgs =
  | { kind: "subscription-created"; subscriptionId: string }
  | { kind: "subscription-cancelled"; subscriptionId: string }
  | { kind: "payment-receipt"; subscriptionId: string; paymentId?: string }
  | { kind: "past-due-reminder"; subscriptionId: string };

const db = createDb(config.databaseUrl);

function formatCents(cents: number, symbol: string): string {
  return `${(cents / 100).toFixed(2)} ${symbol}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function intervalLabel(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "each billing period";
  const days = Math.round(seconds / 86400);
  if (days === 1) return "daily";
  if (days === 7) return "weekly";
  if (days >= 28 && days <= 31) return "monthly";
  if (days >= 365 && days <= 366) return "yearly";
  return `every ${days} days`;
}

export async function sendSubscriptionEmail(args: SendSubscriptionEmailArgs): Promise<void> {
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
      console.warn("[sendSubscriptionEmail] subscription not found:", args.subscriptionId);
      return;
    }

    const { subscription, product, customer } = row;
    if (!customer.email) {
      console.log("[sendSubscriptionEmail] customer has no email, skipping:", args.subscriptionId);
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
        `[sendSubscriptionEmail] notifications disabled, skipping ${args.kind} for ${args.subscriptionId}`,
      );
      return;
    }

    const productName = product.name;
    const tokenSymbol = subscription.tokenSymbol;

    let amountLabel = tokenSymbol;
    if (subscription.lastPaymentId) {
      const [lastPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, subscription.lastPaymentId))
        .limit(1);
      if (lastPayment) {
        amountLabel = formatCents(lastPayment.amount, tokenSymbol);
      }
    }

    let subject: string;
    let react;

    if (args.kind === "subscription-created") {
      const { SubscriptionCreatedEmail } = await import("./subscription-created");
      subject = `Your subscription to ${productName} is active`;
      react = createElement(SubscriptionCreatedEmail, {
        productName,
        amountLabel,
        intervalLabel: intervalLabel(subscription.intervalSeconds),
        branding,
      });
    } else if (args.kind === "subscription-cancelled") {
      const { SubscriptionCancelledEmail } = await import("./subscription-cancelled");
      subject = `Your subscription to ${productName} has been cancelled`;
      react = createElement(SubscriptionCancelledEmail, { productName, branding });
    } else if (args.kind === "payment-receipt") {
      const { PaymentReceiptEmail } = await import("./payment-receipt");
      const nextDate = subscription.nextChargeDate
        ? formatDate(new Date(subscription.nextChargeDate))
        : "your next billing date";
      subject = `Payment receipt for ${productName}`;
      react = createElement(PaymentReceiptEmail, {
        productName,
        amountLabel,
        nextChargeDate: nextDate,
        branding,
      });
    } else {
      const { PastDueReminderEmail } = await import("./past-due-reminder");
      subject = `Action required: ${productName} payment failed`;
      react = createElement(PastDueReminderEmail, {
        productName,
        tokenSymbol,
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
      console.log(`[sendSubscriptionEmail] sent ${args.kind} for ${args.subscriptionId}`);
    } else {
      console.error(
        `[sendSubscriptionEmail] failed ${args.kind} for ${args.subscriptionId}:`,
        result.error,
      );
    }
  } catch (err) {
    console.error("[sendSubscriptionEmail] unexpected error:", err);
  }
}
