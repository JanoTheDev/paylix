import { db } from "@/lib/db";
import { customers, invoices } from "@paylix/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { verifyPortalToken } from "@/lib/portal-tokens";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId");
  const token = url.searchParams.get("token");
  if (!customerId || !token || !verifyPortalToken(token, customerId)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
  }
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
