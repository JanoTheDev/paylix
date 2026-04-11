import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices, customers } from "@paylix/db/schema";
import InvoicesView, { type InvoiceRow } from "./invoices-view";

export default async function InvoicesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
      issuedAt: invoices.issuedAt,
      emailStatus: invoices.emailStatus,
      hostedToken: invoices.hostedToken,
      customerEmail: customers.email,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
    })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .where(eq(invoices.merchantId, session.user.id))
    .orderBy(desc(invoices.issuedAt))
    .limit(500);

  const list: InvoiceRow[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    totalCents: r.totalCents,
    currency: r.currency,
    issuedAt: r.issuedAt.toISOString(),
    emailStatus: r.emailStatus,
    hostedToken: r.hostedToken,
    customerLabel:
      [r.customerFirstName, r.customerLastName].filter(Boolean).join(" ") ||
      r.customerEmail ||
      "—",
  }));
  return <InvoicesView invoices={list} />;
}
