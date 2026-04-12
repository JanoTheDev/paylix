import { db } from "@/lib/db";
import {
  customers,
  subscriptions,
  payments,
  products,
} from "@paylix/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { verifyPortalToken } from "@/lib/portal-tokens";

// Token-protected endpoint. The caller must pass `?token=` signed by
// `signPortalToken(customerId)`. Dashboard users mint these via the
// `/api/customers/[id]/portal-url` helper.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const { customerId } = await params;

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token || !verifyPortalToken(token, customerId)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
  }

  const [customer] = await db
    .select({
      id: customers.id,
      customerId: customers.customerId,
      email: customers.email,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    return NextResponse.json({ error: { code: "not_found", message: "Customer not found" } }, { status: 404 });
  }

  const subs = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      nextChargeDate: subscriptions.nextChargeDate,
      onChainId: subscriptions.onChainId,
      createdAt: subscriptions.createdAt,
      productName: products.name,
      tokenSymbol: subscriptions.tokenSymbol,
      billingInterval: products.billingInterval,
      trialEndsAt: subscriptions.trialEndsAt,
      trialConversionLastError: subscriptions.trialConversionLastError,
      productId: subscriptions.productId,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(eq(subscriptions.customerId, customer.id))
    .orderBy(desc(subscriptions.createdAt));

  const pays = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      status: payments.status,
      txHash: payments.txHash,
      token: payments.token,
      createdAt: payments.createdAt,
      productName: products.name,
    })
    .from(payments)
    .innerJoin(products, eq(payments.productId, products.id))
    .where(eq(payments.customerId, customer.id))
    .orderBy(desc(payments.createdAt))
    .limit(50);

  return NextResponse.json({
    customer,
    subscriptions: subs,
    payments: pays,
  });
}
