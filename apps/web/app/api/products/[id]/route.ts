import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { products, productPrices } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  NETWORKS,
  assertValidNetworkKey,
  assertValidTokenSymbol,
  type NetworkKey,
} from "@paylix/config/networks";

const updateProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  type: z.enum(["one_time", "subscription"]).optional(),
  billingInterval: z
    .enum(["minutely", "weekly", "biweekly", "monthly", "quarterly", "yearly"])
    .nullish(),
  metadata: z.record(z.string()).optional(),
  checkoutFields: z
    .object({
      firstName: z.boolean().optional(),
      lastName: z.boolean().optional(),
      email: z.boolean().optional(),
      phone: z.boolean().optional(),
    })
    .optional(),
  prices: z
    .array(
      z.object({
        networkKey: z.string(),
        tokenSymbol: z.string(),
        amount: z.string(),
      }),
    )
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({
        name: data.name,
        description: data.description,
        type: data.type,
        billingInterval: data.type === "one_time" ? null : data.billingInterval,
        metadata: data.metadata,
        checkoutFields: data.checkoutFields,
      })
      .where(and(eq(products.id, id), eq(products.userId, session.user.id)))
      .returning();

    if (!row) return null;

    if (data.prices) {
      // Validate every price first
      for (const p of data.prices) {
        assertValidNetworkKey(p.networkKey);
        assertValidTokenSymbol(
          NETWORKS[p.networkKey as NetworkKey],
          p.tokenSymbol,
        );
      }

      // Replace: mark old prices inactive, insert new rows. Not a hard delete
      // so historical checkout_sessions still reference valid rows.
      await tx
        .update(productPrices)
        .set({ isActive: false })
        .where(eq(productPrices.productId, id));

      await tx.insert(productPrices).values(
        data.prices.map((p) => ({
          productId: id,
          networkKey: p.networkKey,
          tokenSymbol: p.tokenSymbol,
          amount: BigInt(p.amount),
          isActive: true,
        })),
      );
    }

    return row;
  });

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [updated] = await db
    .update(products)
    .set({ isActive: false })
    .where(and(eq(products.id, id), eq(products.userId, session.user.id)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
