import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, subscriptions } from "@paylix/db/schema";

export async function checkExistingSubscription(args: {
  organizationId: string;
  productId: string;
  buyerWallet: string;
  customerIdentifier: string | null;
}): Promise<{ exists: boolean }> {
  const { organizationId, productId, buyerWallet, customerIdentifier } = args;

  let matchedCustomer: { id: string; email: string | null } | null = null;
  if (customerIdentifier) {
    const [c] = await db
      .select({ id: customers.id, email: customers.email })
      .from(customers)
      .where(
        and(
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

  const existing = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        eq(subscriptions.productId, productId),
        or(
          eq(subscriptions.status, "trialing"),
          eq(subscriptions.status, "active"),
        ),
        or(...conditions),
      ),
    )
    .limit(1);

  return { exists: existing.length > 0 };
}
