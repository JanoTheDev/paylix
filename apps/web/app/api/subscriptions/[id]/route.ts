import { db } from "@/lib/db";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { z } from "zod";

const patchSchema = z.object({
  metadata: z.record(z.string(), z.string()),
});

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const orgCtx = await resolveActiveOrg();
  if (!orgCtx.ok) return orgCtx.response;
  const { organizationId, livemode } = orgCtx;

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Invalid input", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(subscriptions)
    .set({ metadata: parsed.data.metadata })
    .where(
      and(
        eq(subscriptions.id, id),
        orgScope(subscriptions, { organizationId, livemode }),
      ),
    )
    .returning();

  if (!updated) return NextResponse.json({ error: { code: "not_found", message: "Subscription not found" } }, { status: 404 });

  return NextResponse.json({ subscription: updated });
}
