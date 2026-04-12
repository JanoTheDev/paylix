import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { products, productPrices } from "@paylix/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { z } from "zod";
import {
  NETWORKS,
  assertValidNetworkKey,
  assertValidTokenSymbol,
  type NetworkKey,
} from "@paylix/config/networks";

const createProductSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    type: z.enum(["one_time", "subscription"]),
    billingInterval: z
      .enum(["minutely", "weekly", "biweekly", "monthly", "quarterly", "yearly"])
      .optional(),
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
      .min(1, "At least one price is required"),
    taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
    taxLabel: z.string().max(64).nullable().optional(),
    reverseChargeEligible: z.boolean().optional(),
    trialDays: z.number().int().min(0).max(365).nullish(),
    trialMinutes: z.number().int().min(0).max(60 * 24).nullish(),
  })
  .refine((d) => d.type !== "subscription" || !!d.billingInterval, {
    message: "billingInterval is required for subscription products",
    path: ["billingInterval"],
  });

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const rows = await db
    .select()
    .from(products)
    .where(eq(products.organizationId, organizationId))
    .orderBy(products.createdAt);

  const productIds = rows.map((p) => p.id);
  const priceRows =
    productIds.length > 0
      ? await db
          .select()
          .from(productPrices)
          .where(
            and(
              inArray(productPrices.productId, productIds),
              eq(productPrices.isActive, true),
            ),
          )
      : [];

  const pricesByProduct = new Map<string, typeof priceRows>();
  for (const price of priceRows) {
    const list = pricesByProduct.get(price.productId) ?? [];
    list.push(price);
    pricesByProduct.set(price.productId, list);
  }

  return NextResponse.json(
    rows.map((p) => ({
      ...p,
      prices: (pricesByProduct.get(p.id) ?? []).map((pr) => ({
        ...pr,
        amount: pr.amount.toString(),
      })),
    })),
  );
}

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const body = await request.json();
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  for (const price of data.prices) {
    try {
      assertValidNetworkKey(price.networkKey);
      assertValidTokenSymbol(
        NETWORKS[price.networkKey as NetworkKey],
        price.tokenSymbol,
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid price entry" },
        { status: 400 },
      );
    }
  }

  const created = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        organizationId,
        name: data.name,
        description: data.description ?? null,
        type: data.type,
        billingInterval:
          data.type === "subscription" ? (data.billingInterval ?? null) : null,
        metadata: data.metadata ?? {},
        checkoutFields: data.checkoutFields ?? {},
        taxRateBps: data.taxRateBps ?? null,
        taxLabel: data.taxLabel ?? null,
        reverseChargeEligible: data.reverseChargeEligible ?? false,
        trialDays: data.type === "subscription" ? (data.trialDays ?? null) : null,
        trialMinutes: data.type === "subscription" ? (data.trialMinutes ?? null) : null,
      })
      .returning();

    await tx.insert(productPrices).values(
      data.prices.map((p) => ({
        productId: product.id,
        networkKey: p.networkKey,
        tokenSymbol: p.tokenSymbol,
        amount: BigInt(p.amount),
        isActive: true,
      })),
    );

    return product;
  });

  return NextResponse.json(created, { status: 201 });
}
