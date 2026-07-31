import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { customerWallets } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { apiError } from "@/lib/api-error";

const addSchema = z.object({
  customerId: z.string().uuid(),
  token: z.string(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nickname: z.string().max(50).optional(),
});

export async function GET(request: Request) {
  const portal = await requirePortalCustomer(request);
  if (!portal.ok) return portal.response;
  const customerId = portal.customerId;

  const rows = await db
    .select()
    .from(customerWallets)
    .where(eq(customerWallets.customerId, customerId));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("validation_failed", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const portal = await requirePortalCustomer(request, parsed.data);
  if (!portal.ok) return portal.response;
  const customerId = portal.customerId;
  const { address, nickname } = parsed.data;

  // Check if this customer already has a primary wallet; if not, this
  // one becomes primary by default.
  const existing = await db
    .select()
    .from(customerWallets)
    .where(eq(customerWallets.customerId, customerId));
  const hasPrimary = existing.some((w) => w.isPrimary);

  try {
    const [row] = await db
      .insert(customerWallets)
      .values({
        customerId,
        address: address.toLowerCase(),
        nickname: nickname ?? null,
        isPrimary: !hasPrimary,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch {
    return apiError("duplicate", "Wallet already added", 409);
  }
}
