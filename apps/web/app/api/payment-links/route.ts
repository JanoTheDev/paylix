import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { paymentLinks, products } from "@paylix/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { withIdempotency } from "@/lib/idempotency";

const createSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1).max(100),
  customerId: z.string().optional(),
  networkKey: z.string().optional(),
  tokenSymbol: z.string().optional(),
  maxRedemptions: z.number().int().min(1).optional(),
  metadata: z.record(z.string()).optional(),
});

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const rows = await db
    .select()
    .from(paymentLinks)
    .where(orgScope(paymentLinks, { organizationId, livemode }))
    .orderBy(desc(paymentLinks.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  return withIdempotency(request, organizationId, async (rawBody) => {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiError("invalid_body", "Request body must be valid JSON.", 400);
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "validation_failed",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

  const [product] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, parsed.data.productId),
        orgScope(products, { organizationId, livemode }),
      ),
    )
    .limit(1);
  if (!product) return apiError("not_found", "Product not found", 404);
  if (
    (parsed.data.networkKey && !parsed.data.tokenSymbol) ||
    (!parsed.data.networkKey && parsed.data.tokenSymbol)
  ) {
    return apiError(
      "invalid_request",
      "networkKey and tokenSymbol must both be provided or both omitted",
    );
  }

  const [row] = await db
    .insert(paymentLinks)
    .values({
      organizationId,
      productId: product.id,
      name: parsed.data.name,
      customerId: parsed.data.customerId ?? null,
      networkKey: parsed.data.networkKey ?? null,
      tokenSymbol: parsed.data.tokenSymbol ?? null,
      maxRedemptions: parsed.data.maxRedemptions ?? null,
      metadata: parsed.data.metadata ?? {},
      livemode,
    })
    .returning();

  void recordAudit({
    organizationId,
    userId,
    action: "payment_link.created",
    resourceType: "payment_link",
    resourceId: row.id,
    details: { productId: product.id, name: row.name },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

    return NextResponse.json(row, { status: 201 });
  });
}
