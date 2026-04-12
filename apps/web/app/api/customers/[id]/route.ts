import { db } from "@/lib/db";
import {
  customers,
  invoices,
  payments,
  products,
  subscriptions,
} from "@paylix/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { z } from "zod";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const orgCtx = await resolveActiveOrg();
  if (!orgCtx.ok) return orgCtx.response;
  const { organizationId } = orgCtx;

  const { id } = await ctx.params;

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
    .limit(1);

  if (!customer) return NextResponse.json({ error: { code: "not_found", message: "Customer not found" } }, { status: 404 });

  const [customerPayments, customerSubscriptions, customerInvoices] =
    await Promise.all([
      db
        .select({
          id: payments.id,
          amount: payments.amount,
          fee: payments.fee,
          status: payments.status,
          txHash: payments.txHash,
          createdAt: payments.createdAt,
          productName: products.name,
          productType: products.type,
          metadata: payments.metadata,
        })
        .from(payments)
        .leftJoin(products, eq(payments.productId, products.id))
        .where(and(eq(payments.customerId, id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt)),
      db
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          createdAt: subscriptions.createdAt,
          nextChargeDate: subscriptions.nextChargeDate,
          trialEndsAt: subscriptions.trialEndsAt,
          productName: products.name,
          metadata: subscriptions.metadata,
        })
        .from(subscriptions)
        .leftJoin(products, eq(subscriptions.productId, products.id))
        .where(
          and(
            eq(subscriptions.customerId, id),
            eq(subscriptions.organizationId, organizationId),
          ),
        )
        .orderBy(desc(subscriptions.createdAt)),
      db
        .select({
          id: invoices.id,
          number: invoices.number,
          totalCents: invoices.totalCents,
          currency: invoices.currency,
          issuedAt: invoices.issuedAt,
          emailStatus: invoices.emailStatus,
          hostedToken: invoices.hostedToken,
        })
        .from(invoices)
        .where(
          and(eq(invoices.customerId, id), eq(invoices.organizationId, organizationId)),
        )
        .orderBy(desc(invoices.issuedAt)),
    ]);

  return NextResponse.json({
    customer,
    payments: customerPayments,
    subscriptions: customerSubscriptions,
    invoices: customerInvoices,
  });
}

const patchSchema = z.object({
  firstName: z.string().trim().max(100).nullish(),
  lastName: z.string().trim().max(100).nullish(),
  email: z.string().trim().email().nullish(),
  walletAddress: z.string().trim().max(100).nullish(),
  phone: z.string().trim().max(50).nullish(),
  country: z.string().trim().length(2).nullish(),
  taxId: z.string().trim().max(100).nullish(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const orgCtx = await resolveActiveOrg();
  if (!orgCtx.ok) return orgCtx.response;
  const { organizationId } = orgCtx;

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Invalid input", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const updates: Record<string, unknown> = {};
  if (data.firstName !== undefined) updates.firstName = data.firstName ?? null;
  if (data.lastName !== undefined) updates.lastName = data.lastName ?? null;
  if (data.email !== undefined) updates.email = data.email ?? null;
  if (data.walletAddress !== undefined)
    updates.walletAddress = data.walletAddress ?? null;
  if (data.phone !== undefined) updates.phone = data.phone ?? null;
  if (data.country !== undefined)
    updates.country = data.country ? data.country.toUpperCase() : null;
  if (data.taxId !== undefined) updates.taxId = data.taxId ?? null;
  if (data.metadata !== undefined) updates.metadata = data.metadata;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No fields to update" } }, { status: 400 });
  }

  const [updated] = await db
    .update(customers)
    .set(updates)
    .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
    .returning();

  if (!updated) return NextResponse.json({ error: { code: "not_found", message: "Customer not found" } }, { status: 404 });

  return NextResponse.json({ customer: updated });
}
