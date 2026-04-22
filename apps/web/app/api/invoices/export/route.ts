import { and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices } from "@paylix/db/schema";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { toCsvLine, type CsvCell } from "@/lib/csv";
import { CSV_MAX_ROWS, csvFilename, csvResponse } from "@/lib/csv-response";

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      issuedAt: invoices.issuedAt,
      customerName: invoices.customerName,
      customerEmail: invoices.customerEmail,
      customerCountry: invoices.customerCountry,
      customerTaxId: invoices.customerTaxId,
      currency: invoices.currency,
      subtotalCents: invoices.subtotalCents,
      taxCents: invoices.taxCents,
      totalCents: invoices.totalCents,
      taxLabel: invoices.taxLabel,
      taxRateBps: invoices.taxRateBps,
      reverseCharge: invoices.reverseCharge,
      emailStatus: invoices.emailStatus,
      emailSentAt: invoices.emailSentAt,
      paymentId: invoices.paymentId,
      hostedToken: invoices.hostedToken,
    })
    .from(invoices)
    .where(and(orgScope(invoices, { organizationId, livemode })))
    .orderBy(desc(invoices.issuedAt))
    .limit(CSV_MAX_ROWS);

  const header: CsvCell[] = [
    "id",
    "number",
    "issued_at",
    "customer_name",
    "customer_email",
    "customer_country",
    "customer_tax_id",
    "currency",
    "subtotal_cents",
    "tax_cents",
    "total_cents",
    "tax_label",
    "tax_rate_bps",
    "reverse_charge",
    "email_status",
    "email_sent_at",
    "payment_id",
    "hosted_token",
  ];

  const lines = [toCsvLine(header)];
  for (const r of rows) {
    lines.push(
      toCsvLine([
        r.id,
        r.number,
        r.issuedAt,
        r.customerName,
        r.customerEmail,
        r.customerCountry,
        r.customerTaxId,
        r.currency,
        r.subtotalCents,
        r.taxCents,
        r.totalCents,
        r.taxLabel,
        r.taxRateBps,
        r.reverseCharge,
        r.emailStatus,
        r.emailSentAt,
        r.paymentId,
        r.hostedToken,
      ]),
    );
  }

  return csvResponse(
    lines.join(""),
    csvFilename("invoices", livemode),
    rows.length,
  );
}
