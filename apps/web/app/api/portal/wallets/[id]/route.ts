import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { customerWallets } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { apiError } from "@/lib/api-error";

const authSchema = z.object({
  customerId: z.string().uuid(),
  token: z.string(),
});

async function authorize(request: Request, walletId: string) {
  const body = await request.json().catch(() => ({}));
  const parsed = authSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, response: apiError("invalid_body", "Missing auth", 400) };
  const portal = await requirePortalCustomer(request, parsed.data);
  if (!portal.ok) return { ok: false as const, response: portal.response };

  // Ownership in the WHERE clause: a wallet belonging to someone else is
  // indistinguishable from one that doesn't exist.
  const [wallet] = await db
    .select()
    .from(customerWallets)
    .where(
      and(
        eq(customerWallets.id, walletId),
        eq(customerWallets.customerId, portal.customerId),
      ),
    )
    .limit(1);
  if (!wallet) {
    return { ok: false as const, response: apiError("not_found", "Wallet not found", 404) };
  }
  return { ok: true as const, wallet, customerId: portal.customerId };
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(request, id);
  if (!auth.ok) return auth.response;
  if (auth.wallet.isPrimary) {
    return apiError(
      "primary_wallet",
      "Set another wallet as primary before removing this one",
      409,
    );
  }
  await db.delete(customerWallets).where(eq(customerWallets.id, id));
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(request, id);
  if (!auth.ok) return auth.response;
  if (auth.wallet.isPrimary) {
    return NextResponse.json({ success: true, alreadyPrimary: true });
  }

  // Flip in a transaction so we never have two primaries.
  await db.transaction(async (tx) => {
    await tx
      .update(customerWallets)
      .set({ isPrimary: false })
      .where(
        and(
          eq(customerWallets.customerId, auth.customerId),
          eq(customerWallets.isPrimary, true),
        ),
      );
    await tx
      .update(customerWallets)
      .set({ isPrimary: true })
      .where(eq(customerWallets.id, id));
  });

  return NextResponse.json({ success: true });
}
