import { db } from "@/lib/db";
import { checkoutSessions, products, payments } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [session] = await db
    .select({
      id: checkoutSessions.id,
      status: checkoutSessions.status,
      amount: checkoutSessions.amount,
      currency: checkoutSessions.currency,
      chain: checkoutSessions.chain,
      type: checkoutSessions.type,
      merchantWallet: checkoutSessions.merchantWallet,
      customerId: checkoutSessions.customerId,
      successUrl: checkoutSessions.successUrl,
      cancelUrl: checkoutSessions.cancelUrl,
      metadata: checkoutSessions.metadata,
      expiresAt: checkoutSessions.expiresAt,
      productId: checkoutSessions.productId,
      paymentId: checkoutSessions.paymentId,
      productName: products.name,
      productDescription: products.description,
      checkoutFields: products.checkoutFields,
      billingInterval: products.billingInterval,
      customerUuid: payments.customerId,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .leftJoin(payments, eq(checkoutSessions.paymentId, payments.id))
    .where(eq(checkoutSessions.id, id));

  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Check if expired
  if (session.status === "active" && new Date(session.expiresAt) < new Date()) {
    await db
      .update(checkoutSessions)
      .set({ status: "expired" })
      .where(eq(checkoutSessions.id, id));
    return NextResponse.json({ ...session, status: "expired" });
  }

  return NextResponse.json(session);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const allowedUpdates: Record<string, unknown> = {};

  // Mark as viewed
  if (body.status === "viewed") {
    allowedUpdates.status = "viewed";
    allowedUpdates.viewedAt = new Date();
  }

  // Mark as completed
  if (body.status === "completed") {
    allowedUpdates.status = "completed";
    allowedUpdates.completedAt = new Date();
    if (body.txHash) allowedUpdates.paymentId = body.txHash;
  }

  // Mark as abandoned
  if (body.status === "abandoned") {
    allowedUpdates.status = "abandoned";
  }

  if (Object.keys(allowedUpdates).length === 0) {
    return NextResponse.json({ error: "No valid updates" }, { status: 400 });
  }

  const [updated] = await db
    .update(checkoutSessions)
    .set(allowedUpdates)
    .where(eq(checkoutSessions.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

// Allow POST as an alias for PATCH (needed for navigator.sendBeacon)
export const POST = PATCH;
