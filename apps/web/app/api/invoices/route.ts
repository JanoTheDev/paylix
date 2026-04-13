import { db } from "@/lib/db";
import { invoices, customers } from "@paylix/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

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
      livemode: invoices.livemode,
    })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .where(orgScope(invoices, { organizationId, livemode }))
    .orderBy(desc(invoices.issuedAt))
    .limit(500);
  return NextResponse.json({ invoices: rows });
}
