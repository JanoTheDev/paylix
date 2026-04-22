import { and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@paylix/db/schema";
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
      id: customers.id,
      customerId: customers.customerId,
      email: customers.email,
      firstName: customers.firstName,
      lastName: customers.lastName,
      phone: customers.phone,
      country: customers.country,
      taxId: customers.taxId,
      walletAddress: customers.walletAddress,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(and(orgScope(customers, { organizationId, livemode })))
    .orderBy(desc(customers.createdAt))
    .limit(CSV_MAX_ROWS);

  const header: CsvCell[] = [
    "id",
    "customer_id",
    "created_at",
    "email",
    "first_name",
    "last_name",
    "phone",
    "country",
    "tax_id",
    "wallet_address",
  ];

  const lines = [toCsvLine(header)];
  for (const r of rows) {
    lines.push(
      toCsvLine([
        r.id,
        r.customerId,
        r.createdAt,
        r.email,
        r.firstName,
        r.lastName,
        r.phone,
        r.country,
        r.taxId,
        r.walletAddress,
      ]),
    );
  }

  return csvResponse(
    lines.join(""),
    csvFilename("customers", livemode),
    rows.length,
  );
}
