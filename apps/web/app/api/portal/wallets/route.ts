import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { customerWallets } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verifyPortalToken } from "@/lib/portal-tokens";
import { apiError } from "@/lib/api-error";

const addSchema = z.object({
  customerId: z.string().uuid(),
  token: z.string(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nickname: z.string().max(50).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const token = url.searchParams.get("token");
  if (!customerId || !token) {
    return apiError("invalid_body", "Missing customerId or token", 400);
  }
  if (!verifyPortalToken(token, customerId)) {
    return apiError("invalid_token", "Invalid or expired portal token", 401);
  }
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
  const { customerId, token, address, nickname } = parsed.data;
  if (!verifyPortalToken(token, customerId)) {
    return apiError("invalid_token", "Invalid or expired portal token", 401);
  }

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
