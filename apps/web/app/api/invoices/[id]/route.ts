import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices, invoiceLineItems } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { requireActiveOrg, AuthError } from "@/lib/require-active-org";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth.api.getSession({ headers: await headers() });
  let organizationId: string;
  try {
    organizationId = requireActiveOrg(session);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)))
    .limit(1);
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const lineItems = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoice.id));
  return NextResponse.json({ invoice, lineItems });
}
