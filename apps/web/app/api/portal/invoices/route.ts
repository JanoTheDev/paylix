import { db } from "@/lib/db";
import { customers, invoices } from "@paylix/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/lib/portal-auth";

export async function GET(req: Request) {
  const portal = await requirePortalCustomer(req);
  if (!portal.ok) return portal.response;
  const customerId = portal.customerId;

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) {
    return NextResponse.json({ error: { code: "not_found", message: "Customer not found" } }, { status: 404 });
  }
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
      issuedAt: invoices.issuedAt,
      hostedToken: invoices.hostedToken,
    })
    .from(invoices)
    .where(eq(invoices.customerId, customer.id))
    .orderBy(desc(invoices.issuedAt))
    .limit(100);
  return NextResponse.json({ invoices: rows });
}
