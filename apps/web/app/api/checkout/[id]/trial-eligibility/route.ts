import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkoutSessions, products } from "@paylix/db/schema";
import { checkExistingSubscription } from "../relay/dedup";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const buyer = url.searchParams.get("buyer");

  if (!buyer || !/^0x[0-9a-fA-F]{40}$/.test(buyer)) {
    return NextResponse.json(
      { error: { code: "invalid_buyer" } },
      { status: 400 },
    );
  }

  const [session] = await db
    .select({
      organizationId: checkoutSessions.organizationId,
      productId: checkoutSessions.productId,
      customerId: checkoutSessions.customerId,
      type: checkoutSessions.type,
      trialDays: products.trialDays,
      trialMinutes: products.trialMinutes,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .where(eq(checkoutSessions.id, id));

  if (!session) {
    return NextResponse.json(
      { error: { code: "session_not_found" } },
      { status: 404 },
    );
  }

  const trialDuration =
    (session.trialMinutes ?? 0) > 0
      ? (session.trialMinutes ?? 0) * 60
      : (session.trialDays ?? 0) * 24 * 60 * 60;
  const productHasTrial = session.type === "subscription" && trialDuration > 0;

  if (!productHasTrial) {
    return NextResponse.json({ eligible: false, productHasTrial: false });
  }

  const dedup = await checkExistingSubscription({
    organizationId: session.organizationId,
    productId: session.productId,
    buyerWallet: buyer,
    customerIdentifier: session.customerId ?? null,
    intent: "trial",
  });

  return NextResponse.json({
    eligible: !dedup.exists,
    productHasTrial: true,
  });
}
