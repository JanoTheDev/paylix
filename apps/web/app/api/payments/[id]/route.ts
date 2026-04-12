import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments, customers, checkoutSessions } from "@paylix/db/schema";
import { authenticateApiKey } from "@/lib/api-auth";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { z } from "zod";

const patchSchema = z.object({
  metadata: z.record(z.string(), z.string()),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Invalid input", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(payments)
    .set({ metadata: parsed.data.metadata })
    .where(and(eq(payments.id, id), eq(payments.organizationId, organizationId)))
    .returning();

  if (!updated) return NextResponse.json({ error: { code: "not_found", message: "Payment not found" } }, { status: 404 });

  return NextResponse.json({ payment: updated });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiAuth = await authenticateApiKey(request, "secret");
  if (apiAuth?.rateLimitResponse) return apiAuth.rateLimitResponse;
  if (!apiAuth) return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });

  const { id } = await params;

  const [row] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      fee: payments.fee,
      status: payments.status,
      txHash: payments.txHash,
      chain: payments.chain,
      productId: payments.productId,
      externalCustomerId: customers.customerId,
      metadata: checkoutSessions.metadata,
    })
    .from(payments)
    .innerJoin(customers, eq(payments.customerId, customers.id))
    .leftJoin(checkoutSessions, eq(checkoutSessions.paymentId, payments.id))
    .where(and(eq(payments.id, id), eq(payments.organizationId, apiAuth.organizationId)));

  if (!row) return NextResponse.json({ error: { code: "not_found", message: "Payment not found" } }, { status: 404 });

  return NextResponse.json({
    verified: row.status === "confirmed" && !!row.txHash,
    amount: row.amount,
    fee: row.fee,
    txHash: row.txHash,
    chain: row.chain,
    customerId: row.externalCustomerId,
    productId: row.productId,
    status: row.status,
    metadata: row.metadata ?? {},
  });
}
