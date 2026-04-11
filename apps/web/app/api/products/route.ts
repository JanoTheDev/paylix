import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { products, productPrices } from "@paylix/db/schema";
import { eq, and, inArray } from "drizzle-orm";
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
          amount: z.string(), // bigint as string over the wire
        }),
      )
      .min(1, "At least one price is required"),
  })
  .refine((d) => d.type !== "subscription" || !!d.billingInterval, {
    message: "billingInterval is required for subscription products",
    path: ["billingInterval"],
  });

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(products)
    .where(eq(products.userId, session.user.id))
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
        amount: pr.amount.toString(), // bigint → string over JSON
      })),
    })),
  );
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Validate every price against the registry before creating the product
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
        userId: session.user.id,
        name: data.name,
        description: data.description ?? null,
        type: data.type,
        billingInterval:
          data.type === "subscription" ? (data.billingInterval ?? null) : null,
        metadata: data.metadata ?? {},
        checkoutFields: data.checkoutFields ?? {},
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
