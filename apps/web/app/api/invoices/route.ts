import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices, customers } from "@paylix/db/schema";
import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
  return NextResponse.json({ invoices: rows });
}
