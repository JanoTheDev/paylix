import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, customers, products } from "@paylix/db/schema";
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
  const filters: SQL[] = [orgScope(subscriptions, { organizationId, livemode })];
  const statusFilter = url.searchParams.get("status");
  if (statusFilter) {
    filters.push(eq(subscriptions.status, statusFilter as never));
  }

  const rows = await db
    .select({
      id: subscriptions.id,
      onChainId: subscriptions.onChainId,
      status: subscriptions.status,
      intervalSeconds: subscriptions.intervalSeconds,
      subscriberAddress: subscriptions.subscriberAddress,
      networkKey: subscriptions.networkKey,
      tokenSymbol: subscriptions.tokenSymbol,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      nextChargeDate: subscriptions.nextChargeDate,
      trialEndsAt: subscriptions.trialEndsAt,
      metadata: subscriptions.metadata,
      productName: products.name,
      customerExternalId: customers.customerId,
      customerEmail: customers.email,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .leftJoin(customers, eq(customers.id, subscriptions.customerId))
    .leftJoin(products, eq(products.id, subscriptions.productId))
    .where(and(...filters))
    .orderBy(desc(subscriptions.createdAt))
    .limit(CSV_MAX_ROWS);

  const metaKeys = metadataKeys(rows.map((r) => ({ metadata: r.metadata })));
  const header: CsvCell[] = [
    "id",
    "on_chain_id",
    "created_at",
    "status",
    "interval_seconds",
    "token",
    "chain",
    "subscriber_address",
    "product_name",
    "customer_id",
    "customer_email",
    "current_period_start",
    "current_period_end",
    "next_charge_date",
    "trial_ends_at",
    ...metaKeys.map((k) => `metadata.${k}`),
  ];

  const lines = [toCsvLine(header)];
  for (const r of rows) {
    lines.push(
      toCsvLine([
        r.id,
        r.onChainId,
        r.createdAt,
        r.status,
        r.intervalSeconds,
        r.tokenSymbol,
        r.networkKey,
        r.subscriberAddress,
        r.productName,
        r.customerExternalId,
        r.customerEmail,
        r.currentPeriodStart,
        r.currentPeriodEnd,
        r.nextChargeDate,
        r.trialEndsAt,
        ...metadataCells(r.metadata, metaKeys),
      ]),
    );
  }

  return csvResponse(
    lines.join(""),
    csvFilename("subscriptions", livemode),
    rows.length,
  );
}
