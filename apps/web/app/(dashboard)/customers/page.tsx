import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { count, desc, eq, max, sql, sum } from "drizzle-orm";
import { customers, payments, subscriptions } from "@paylix/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireActiveOrg } from "@/lib/require-active-org";
import CustomersView, { type CustomerRow } from "./customers-view";

export default async function CustomersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  let organizationId: string;
  try {
    organizationId = requireActiveOrg(session);
  } catch {
    redirect("/login");
  }

  const raw = await db
    .select({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      email: customers.email,
      walletAddress: customers.walletAddress,
      source: customers.source,
      totalSpent: sum(
        sql`CASE WHEN ${payments.status} = 'confirmed' THEN ${payments.amount} ELSE 0 END`,
      ),
      paymentCount: count(payments.id),
      lastPayment: max(payments.createdAt),
    })
    .from(customers)
    .leftJoin(payments, eq(customers.id, payments.customerId))
    .where(eq(customers.organizationId, organizationId))
    .groupBy(customers.id)
    .orderBy(desc(customers.createdAt));

  const subRows = await db
    .select({
      customerId: subscriptions.customerId,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId));

  const subByCustomer = new Map<
    string,
    { active: number; pastDue: number; trialing: number }
  >();
  for (const s of subRows) {
    const agg =
      subByCustomer.get(s.customerId) ?? {
        active: 0,
        pastDue: 0,
        trialing: 0,
      };
    if (s.status === "active") agg.active += 1;
    if (s.status === "past_due") agg.pastDue += 1;
    if (s.status === "trialing") agg.trialing += 1;
    subByCustomer.set(s.customerId, agg);
  }

  const rows: CustomerRow[] = raw.map((r) => {
    const agg =
      subByCustomer.get(r.id) ?? { active: 0, pastDue: 0, trialing: 0 };
    return {
      id: r.id,
      name:
        r.firstName || r.lastName
          ? [r.firstName, r.lastName].filter(Boolean).join(" ")
          : "—",
      email: r.email,
      walletAddress: r.walletAddress,
      source: r.source,
      totalSpent: Number(r.totalSpent ?? 0),
      paymentCount: Number(r.paymentCount ?? 0),
      lastPayment: r.lastPayment ? new Date(r.lastPayment) : null,
      activeSubscriptionCount: agg.active,
      hasPastDue: agg.pastDue > 0,
      hasActiveTrial: agg.trialing > 0,
    };
  });

  return <CustomersView rows={rows} />;
}
