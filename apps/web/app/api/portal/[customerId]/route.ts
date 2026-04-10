import { db } from "@/lib/db";
import {
  customers,
  subscriptions,
  payments,
  products,
} from "@paylix/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";

// Public endpoint: no auth required. Looks up a customer by their UUID
// (customers.id) — which is globally unique — and returns their subscriptions
// and recent payments. This matches the SDK's `getCustomerPortal` method.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const { customerId } = await params;

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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const subs = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      nextChargeDate: subscriptions.nextChargeDate,
      onChainId: subscriptions.onChainId,
      createdAt: subscriptions.createdAt,
      productName: products.name,
      productPrice: products.price,
      productCurrency: products.currency,
      billingInterval: products.billingInterval,
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
