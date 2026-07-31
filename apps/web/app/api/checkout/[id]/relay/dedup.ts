import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, subscriptions } from "@paylix/db/schema";
import { normalizeEmail } from "@/lib/email-normalize";
import { orgScope } from "@/lib/org-scope";

export async function checkExistingSubscription(args: {
  organizationId: string;
  /**
   * Mode the calling session runs in. Without it the "one trial per product
   * per identity, ever" rule conflated test and live: a merchant testing
   * their own trial flow permanently burned that wallet/email for live mode.
   */
  livemode: boolean;
  productId: string;
  buyerWallet: string;
  customerIdentifier: string | null;
  buyerEmail: string | null;
  intent: "trial" | "subscription";
}): Promise<{ exists: boolean }> {
  const {
    organizationId,
    livemode,
    productId,
    buyerWallet,
    customerIdentifier,
    buyerEmail,
    intent,
  } = args;

  const normalizedBuyerEmail = buyerEmail ? normalizeEmail(buyerEmail) : null;

  let matchedCustomer: { id: string; email: string | null } | null = null;
  if (customerIdentifier) {
    const [c] = await db
      .select({ id: customers.id, email: customers.email })
      .from(customers)
      .where(
        and(
          // NOT livemode-scoped on purpose: `customers_org_customer_idx` is
          // unique on (organization_id, customer_id) with no livemode, so a
          // customer row is shared across modes. Filtering by mode here
          // would miss the row that actually exists. The mode separation
          // API-17 asks for lives on the `subscriptions` query below, which
          // is where the trial-dedup statuses are.
          eq(customers.organizationId, organizationId),
          eq(customers.customerId, customerIdentifier),
        ),
      )
      .limit(1);
    matchedCustomer = c ?? null;
  }

  const conditions = [
    sql`lower(${subscriptions.subscriberAddress}) = lower(${buyerWallet})`,
  ];

  if (matchedCustomer) {
    conditions.push(eq(subscriptions.customerId, matchedCustomer.id));
  }

  if (matchedCustomer?.email) {
    conditions.push(sql`${subscriptions.customerId} IN (
      SELECT ${customers.id} FROM ${customers}
      WHERE ${customers.organizationId} = ${organizationId}
        AND lower(${customers.email}) = lower(${matchedCustomer.email})
    )`);
  }

  if (normalizedBuyerEmail) {
    conditions.push(sql`${subscriptions.customerId} IN (
      SELECT ${customers.id} FROM ${customers}
      WHERE ${customers.organizationId} = ${organizationId}
        AND lower(${customers.email}) = ${normalizedBuyerEmail}
    )`);
  }

  const statusFilter =
    intent === "trial"
      ? or(
          eq(subscriptions.status, "trialing"),
          eq(subscriptions.status, "active"),
          eq(subscriptions.status, "past_due"),
          eq(subscriptions.status, "cancelled"),
          eq(subscriptions.status, "trial_conversion_failed"),
          eq(subscriptions.status, "expired"),
        )
      : or(
          eq(subscriptions.status, "trialing"),
          eq(subscriptions.status, "active"),
          eq(subscriptions.status, "past_due"),
        );

  const existing = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        orgScope(subscriptions, { organizationId, livemode }),
        eq(subscriptions.productId, productId),
        statusFilter,
        or(...conditions),
      ),
    )
    .limit(1);

  return { exists: existing.length > 0 };
}
