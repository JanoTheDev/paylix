import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments, customers } from "@paylix/db/schema";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import {
  metadataCells,
  metadataKeys,
  toCsvLine,
  type CsvCell,
} from "@/lib/csv";
import { CSV_MAX_ROWS, csvFilename, csvResponse } from "@/lib/csv-response";

export async function GET(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const url = new URL(request.url);
  const filters: SQL[] = [orgScope(payments, { organizationId, livemode })];
  const statusFilter = url.searchParams.get("status");
  if (statusFilter) {
    filters.push(eq(payments.status, statusFilter as "pending" | "confirmed" | "failed"));
  }

  const rows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      fee: payments.fee,
      status: payments.status,
      txHash: payments.txHash,
      chain: payments.chain,
      token: payments.token,
      productId: payments.productId,
      fromAddress: payments.fromAddress,
      toAddress: payments.toAddress,
      metadata: payments.metadata,
      customerExternalId: customers.customerId,
      customerEmail: customers.email,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .where(and(...filters))
    .orderBy(desc(payments.createdAt))
    .limit(CSV_MAX_ROWS);

  const metaKeys = metadataKeys(rows.map((r) => ({ metadata: r.metadata })));
  const header: CsvCell[] = [
    "id",
    "created_at",
    "status",
    "amount_cents",
    "fee_cents",
    "token",
    "chain",
    "tx_hash",
    "product_id",
    "customer_id",
    "customer_email",
    "from_address",
    "to_address",
    ...metaKeys.map((k) => `metadata.${k}`),
  ];

  const lines = [toCsvLine(header)];
  for (const r of rows) {
    lines.push(
      toCsvLine([
        r.id,
        r.createdAt,
        r.status,
        r.amount,
        r.fee,
        r.token,
        r.chain,
        r.txHash,
        r.productId,
        r.customerExternalId,
        r.customerEmail,
        r.fromAddress,
        r.toAddress,
        ...metadataCells(r.metadata, metaKeys),
      ]),
    );
  }

  return csvResponse(
    lines.join(""),
    csvFilename("payments", livemode),
    rows.length,
  );
}
