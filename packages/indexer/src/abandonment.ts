/**
 * Keeper tick: emails a recovery link to buyers who reached the
 * checkout, submitted an email, and left without paying. Runs every
 * keeper cycle; idempotent via `recovery_email_sent_at`.
 */

import { createElement } from "react";

// Same normalization + blocklist the checkout path enforces. The local copy
// here had drifted to 6 domains against checkout's 148, so this mailer was
// emailing disposable addresses that checkout itself refuses.
import { normalizeEmail, isDisposableEmail } from "./email-normalize";

export async function runCheckoutRecoveryTick(): Promise<{ scanned: number }> {
  const { createDb } = await import("@paylix/db/client");
  const { checkoutSessions, products } = await import("@paylix/db/schema");
  const { and, eq, isNull, isNotNull, lte } = await import("drizzle-orm");
  const { config } = await import("./config");
  const { isNotificationEnabled } = await import("./emails/notifications-enabled");
  const { sendMail } = await import("@paylix/mailer");

  const db = createDb(config.databaseUrl);
  const now = new Date();
  // Only target sessions that went abandoned at least 60 minutes ago — gives
  // the buyer a breather so we don't nudge someone who just closed a tab
  // momentarily.
  const minAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const rows = await db
    .select({
      id: checkoutSessions.id,
      organizationId: checkoutSessions.organizationId,
      buyerEmail: checkoutSessions.buyerEmail,
      status: checkoutSessions.status,
      expiresAt: checkoutSessions.expiresAt,
      viewedAt: checkoutSessions.viewedAt,
      createdAt: checkoutSessions.createdAt,
      livemode: checkoutSessions.livemode,
      productName: products.name,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(products.id, checkoutSessions.productId))
    .where(
      and(
        eq(checkoutSessions.status, "abandoned"),
        isNotNull(checkoutSessions.buyerEmail),
        isNull(checkoutSessions.recoveryEmailSentAt),
        lte(checkoutSessions.viewedAt, minAgo),
      ),
    )
    .limit(50);

  for (const row of rows) {
    if (!row.buyerEmail) continue;
    const normalized = normalizeEmail(row.buyerEmail);
    if (isDisposableEmail(normalized)) {
      await db
        .update(checkoutSessions)
        .set({ recoveryEmailSentAt: now })
        .where(eq(checkoutSessions.id, row.id));
      continue;
    }
    if (!(await isNotificationEnabled(row.organizationId, "checkoutRecovery"))) {
      await db
        .update(checkoutSessions)
        .set({ recoveryEmailSentAt: now })
        .where(eq(checkoutSessions.id, row.id));
      continue;
    }

    const { CheckoutAbandonedEmail } = await import("./emails/checkout-abandoned");
    const { loadEmailBranding } = await import("./emails/load-branding");
    const restartUrl = `${config.publicAppUrl}/checkout/restart/${row.id}`;
    const branding = await loadEmailBranding(row.organizationId);

    try {
      await sendMail({
        to: row.buyerEmail,
        from: config.defaultFromEmail,
        subject: `Finish your ${row.productName} checkout`,
        react: createElement(CheckoutAbandonedEmail, {
          productName: row.productName,
          restartUrl,
          merchantName: branding.legalName,
          branding,
        }),
      });
    } catch (err) {
      console.error("[CheckoutRecovery] send failed for", row.id, err);
    }

    // Stamp regardless of send outcome — we don't retry on transient
    // failures here, matching the trial email ticks' behavior. The
    // buyer can always receive a fresh nudge via a new checkout.
    await db
      .update(checkoutSessions)
      .set({ recoveryEmailSentAt: new Date() })
      .where(eq(checkoutSessions.id, row.id));
  }

  return { scanned: rows.length };
}
