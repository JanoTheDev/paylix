import { db } from "@/lib/db";
import { checkoutSessions, customers, products, payments } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { signPortalToken } from "@/lib/portal-tokens";

interface CustomerFormPayload {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  country?: unknown;
  taxId?: unknown;
}

function cleanString(value: unknown, { upper = false }: { upper?: boolean } = {}) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return upper ? trimmed.toUpperCase() : trimmed;
}

function normalizeCustomerForm(raw: CustomerFormPayload) {
  return {
    firstName: cleanString(raw.firstName),
    lastName: cleanString(raw.lastName),
    email: cleanString(raw.email),
    phone: cleanString(raw.phone),
    country: cleanString(raw.country, { upper: true }),
    taxId: cleanString(raw.taxId),
  };
}

function hasAnyValue(values: Record<string, string | null>) {
  return Object.values(values).some((v) => v !== null);
}

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
      networkKey: checkoutSessions.networkKey,
      tokenSymbol: checkoutSessions.tokenSymbol,
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
  // session.amount is a bigint (native token units) — JSON.stringify can't
  // handle BigInt, so serialize it to a string before returning.
  const serialized = {
    ...session,
    amount: session.amount?.toString() ?? null,
  };

  if (session.status === "active" && new Date(session.expiresAt) < new Date()) {
    await db
      .update(checkoutSessions)
      .set({ status: "expired" })
      .where(eq(checkoutSessions.id, id));
    return NextResponse.json({ ...serialized, status: "expired" });
  }

  const portalToken = session.customerUuid
    ? signPortalToken(session.customerUuid)
    : null;

  return NextResponse.json({ ...serialized, portalToken });
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

  // Note: "completed" status is intentionally NOT accepted here.
  // Only the indexer may mark sessions completed via direct DB writes,
  // since that change reflects on-chain financial state.

  // Mark as abandoned
  if (body.status === "abandoned") {
    allowedUpdates.status = "abandoned";
  }

  // Persist collected customer form fields (names, email, phone, country,
  // taxId) onto the customers row. We can only do this pre-payment when the
  // merchant has attached a stable customerId to the session — otherwise
  // the customer row is created by the indexer after PaymentReceived, and
  // we have no key to upsert against yet.
  //
  // Regardless of named/anonymous, we also stash country + taxId on the
  // checkout_sessions row itself so the indexer can propagate them into the
  // customer row when it creates the anon_<wallet> customer post-payment.
  let customerUpserted = false;
  if (body.customer && typeof body.customer === "object") {
    const normalized = normalizeCustomerForm(body.customer as CustomerFormPayload);
    if (hasAnyValue(normalized)) {
      const [session] = await db
        .select({
          organizationId: checkoutSessions.organizationId,
          customerId: checkoutSessions.customerId,
        })
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, id));

      if (session) {
        if (normalized.country !== null || normalized.taxId !== null) {
          await db
            .update(checkoutSessions)
            .set({
              buyerCountry: normalized.country,
              buyerTaxId: normalized.taxId,
            })
            .where(eq(checkoutSessions.id, id));
        }

        if (session.customerId) {
          const setValues: Record<string, string> = {};
          for (const [k, v] of Object.entries(normalized)) {
            if (v !== null) setValues[k] = v;
          }
          await db
            .insert(customers)
            .values({
              organizationId: session.organizationId,
              customerId: session.customerId,
              ...setValues,
            })
            .onConflictDoUpdate({
              target: [customers.organizationId, customers.customerId],
              set: setValues,
            });
          customerUpserted = true;
        }
      }
    }
  }

  if (Object.keys(allowedUpdates).length === 0) {
    if (customerUpserted) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "No valid updates" }, { status: 400 });
  }

  const [updated] = await db
    .update(checkoutSessions)
    .set(allowedUpdates)
    .where(eq(checkoutSessions.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ...updated,
    amount: updated.amount?.toString() ?? null,
  });
}

// Allow POST as an alias for PATCH (needed for navigator.sendBeacon)
export const POST = PATCH;
