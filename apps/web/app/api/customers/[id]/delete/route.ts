import { db } from "@/lib/db";
import { customers } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/require-active-org";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const orgCtx = await resolveActiveOrg();
  if (!orgCtx.ok) return orgCtx.response;
  const { organizationId } = orgCtx;

  const { id } = await ctx.params;

  const [updated] = await db
    .update(customers)
    .set({ deletedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
    .returning({ id: customers.id });

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
