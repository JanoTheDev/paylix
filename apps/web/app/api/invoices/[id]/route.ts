import { db } from "@/lib/db";
import { invoices, invoiceLineItems } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const orgCtx = await resolveActiveOrg();
  if (!orgCtx.ok) return orgCtx.response;
  const { organizationId, livemode } = orgCtx;

  const { id } = await ctx.params;
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), orgScope(invoices, { organizationId, livemode })))
    .limit(1);
  if (!invoice) {
    return NextResponse.json({ error: { code: "not_found", message: "Invoice not found" } }, { status: 404 });
  }
  const lineItems = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoice.id));
  return NextResponse.json({ invoice, lineItems });
}
