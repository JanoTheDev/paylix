import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { products, productPrices } from "@paylix/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { recordAudit } from "@/lib/audit";
import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { withIdempotency } from "@/lib/idempotency";
import { orgScope } from "@/lib/org-scope";
import { clientIp } from "../_shared/client-ip";
import { parseJsonBody, parseWith } from "../_shared/http";
import { productPriceSchema } from "../_shared/price-schema";
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
    prices: z.array(productPriceSchema).min(1, "At least one price is required"),
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

// List endpoints are bounded so a large catalogue can't load the whole table
// into memory on every dashboard render. `limit`/`offset` let callers page.
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

function readPaging(request: Request): { limit: number; offset: number } {
  const params = new URL(request.url).searchParams;
  const rawLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const rawOffset = Number.parseInt(params.get("offset") ?? "", 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

export async function GET(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;
  const { limit, offset } = readPaging(request);

  const rows = await db
    .select()
    .from(products)
    .where(orgScope(products, { organizationId, livemode }))
    .orderBy(products.createdAt)
    .limit(limit)
    .offset(offset);

  const productIds = rows.map((p) => p.id);
  const priceRows =
    productIds.length > 0
      ? await db
          .select()
          .from(productPrices)
          .where(
            and(
              inArray(productPrices.productId, productIds),
              // Ownership comes from the org-scoped products above; mode
              // still has to be filtered explicitly since product_prices
              // has no organization_id of its own.
              eq(productPrices.livemode, livemode),
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
  const { organizationId, userId, livemode } = ctx;

  return withIdempotency(request, organizationId, async (rawBody) => {
    const body = parseJsonBody(rawBody);
    if (!body.ok) return body.response;
    const parsed = parseWith(createProductSchema, body.data);
    if (!parsed.ok) return parsed.response;

    const data = parsed.data;

    // Trial products MUST collect email — it's required for the anti-abuse
    // dedup to work. Force email = true regardless of what the merchant sent.
    const hasTrial =
      (data.trialDays ?? 0) > 0 || (data.trialMinutes ?? 0) > 0;
    if (hasTrial && data.type === "subscription") {
      data.checkoutFields = {
        ...(data.checkoutFields ?? {}),
        email: true,
      };
    }

    for (const price of data.prices) {
      try {
        assertValidNetworkKey(price.networkKey);
        assertValidTokenSymbol(
          NETWORKS[price.networkKey as NetworkKey],
          price.tokenSymbol,
        );
      } catch (err) {
        return apiError("invalid_price", err instanceof Error ? err.message : "Invalid price entry");
      }
    }

    const created = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          organizationId,
          livemode,
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
          livemode,
          networkKey: p.networkKey,
          tokenSymbol: p.tokenSymbol,
          amount: BigInt(p.amount),
          isActive: true,
        })),
      );

      return product;
    });

    void recordAudit({
      organizationId,
      userId,
      action: "product.created",
      resourceType: "product",
      resourceId: created.id,
      details: { name: created.name, type: created.type },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(created, { status: 201 });
  });
}
