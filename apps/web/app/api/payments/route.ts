import { NextResponse } from "next/server";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments, customers, checkoutSessions } from "@paylix/db/schema";
import { authenticateApiKey } from "@/lib/api-auth";
import { orgScope } from "@/lib/org-scope";

export async function GET(request: Request) {
  const apiAuth = await authenticateApiKey(request, "secret");
  if (apiAuth?.rateLimitResponse) return apiAuth.rateLimitResponse;
  if (!apiAuth) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const { organizationId, livemode } = apiAuth;
  const url = new URL(request.url);

  const filters: SQL[] = [orgScope(payments, { organizationId, livemode })];

  const customerIdFilter = url.searchParams.get("customerId");
  if (customerIdFilter) {
    filters.push(eq(customers.customerId, customerIdFilter));
  }

  const statusFilter = url.searchParams.get("status");
  if (statusFilter) {
    filters.push(eq(payments.status, statusFilter as "pending" | "confirmed" | "failed"));
  }

  for (const [key, value] of url.searchParams.entries()) {
    const match = key.match(/^metadata\[(.+)]$/);
    if (match) {
      filters.push(
        sql`${payments.metadata} @> ${JSON.stringify({ [match[1]]: value })}::jsonb`,
      );
    }
  }

  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 100);

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
      checkoutMetadata: checkoutSessions.metadata,
      livemode: payments.livemode,
      createdAt: payments.createdAt,
      customer: {
        id: customers.customerId,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        walletAddress: customers.walletAddress,
      },
    })
    .from(payments)
    .innerJoin(customers, eq(payments.customerId, customers.id))
    .leftJoin(checkoutSessions, eq(checkoutSessions.paymentId, payments.id))
    .where(and(...filters))
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  const result = rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    fee: row.fee,
    status: row.status,
    txHash: row.txHash,
    chain: row.chain,
    token: row.token,
    productId: row.productId,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    metadata: { ...row.metadata, ...row.checkoutMetadata },
    livemode: row.livemode,
    createdAt: row.createdAt,
    customer: row.customer,
  }));

  return NextResponse.json(result);
}
