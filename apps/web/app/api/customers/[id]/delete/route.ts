import { db } from "@/lib/db";
import { customers } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { recordAudit } from "@/lib/audit";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const orgCtx = await resolveActiveOrg();
  if (!orgCtx.ok) return orgCtx.response;
  const { organizationId, userId } = orgCtx;

  const { id } = await ctx.params;

  const [updated] = await db
    .update(customers)
    .set({ deletedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
    .returning({ id: customers.id });

  if (!updated) return NextResponse.json({ error: { code: "not_found", message: "Customer not found" } }, { status: 404 });

  void recordAudit({
    organizationId,
    userId,
    action: "customer.deleted",
    resourceType: "customer",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
