import { NextResponse } from "next/server";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, customers, products } from "@paylix/db/schema";
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

  const filters: SQL[] = [orgScope(subscriptions, { organizationId, livemode })];

  const customerIdFilter = url.searchParams.get("customerId");
  if (customerIdFilter) {
    filters.push(eq(customers.customerId, customerIdFilter));
  }

  const statusFilter = url.searchParams.get("status");
  if (statusFilter) {
    filters.push(eq(subscriptions.status, statusFilter as never));
  }

  for (const [key, value] of url.searchParams.entries()) {
    const match = key.match(/^metadata\[(.+)]$/);
    if (match) {
      filters.push(
        sql`${subscriptions.metadata} @> ${JSON.stringify({ [match[1]]: value })}::jsonb`,
      );
    }
  }

  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 100);

  const rows = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      subscriberAddress: subscriptions.subscriberAddress,
      networkKey: subscriptions.networkKey,
      tokenSymbol: subscriptions.tokenSymbol,
      onChainId: subscriptions.onChainId,
      intervalSeconds: subscriptions.intervalSeconds,
      nextChargeDate: subscriptions.nextChargeDate,
      trialEndsAt: subscriptions.trialEndsAt,
      pausedAt: subscriptions.pausedAt,
      productId: subscriptions.productId,
      productName: products.name,
      metadata: subscriptions.metadata,
      livemode: subscriptions.livemode,
      createdAt: subscriptions.createdAt,
      customer: {
        id: customers.customerId,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        walletAddress: customers.walletAddress,
      },
    })
    .from(subscriptions)
    .innerJoin(customers, eq(subscriptions.customerId, customers.id))
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(and(...filters))
    .orderBy(desc(subscriptions.createdAt))
    .limit(limit);

  return NextResponse.json(rows);
}
