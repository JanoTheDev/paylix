import { authenticateApiKey } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { customers, invoices } from "@paylix/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { requireActiveOrg } from "@/lib/require-active-org";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let organizationId: string | null = null;
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    try {
      organizationId = requireActiveOrg(session);
    } catch {
      return NextResponse.json({ error: { code: "no_active_org", message: "No active team selected" } }, { status: 400 });
    }
  } else {
    const apiAuth = await authenticateApiKey(request, "secret");
    if (apiAuth?.rateLimitResponse) return apiAuth.rateLimitResponse;
    if (apiAuth) organizationId = apiAuth.organizationId;
  }
  if (!organizationId) return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });

  const { id } = await params;
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)));
  if (!customer) return NextResponse.json({ error: { code: "not_found", message: "Customer not found" } }, { status: 404 });

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
      subtotalCents: invoices.subtotalCents,
      taxCents: invoices.taxCents,
      taxLabel: invoices.taxLabel,
      issuedAt: invoices.issuedAt,
      emailStatus: invoices.emailStatus,
      hostedToken: invoices.hostedToken,
    })
    .from(invoices)
    .where(eq(invoices.customerId, customer.id))
    .orderBy(desc(invoices.issuedAt))
    .limit(200);

  return NextResponse.json({
    invoices: rows.map((r) => ({
      id: r.id,
      number: r.number,
      totalCents: r.totalCents,
      subtotalCents: r.subtotalCents,
      taxCents: r.taxCents,
      taxLabel: r.taxLabel,
      currency: r.currency,
      issuedAt: r.issuedAt.toISOString(),
      emailStatus: r.emailStatus,
      hostedUrl: `${baseUrl}/i/${r.hostedToken}`,
      invoicePdfUrl: `${baseUrl}/i/${r.hostedToken}/pdf`,
      receiptPdfUrl: `${baseUrl}/i/${r.hostedToken}/receipt`,
    })),
  });
}
