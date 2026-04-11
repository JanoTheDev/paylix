import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { requireActiveOrg, AuthError } from "@/lib/require-active-org";
import { sendMail } from "@paylix/mailer";
import { createElement } from "react";
import { InvoiceEmail } from "@/emails/invoice-email";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: Ctx) {
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
  if (!invoice.customerEmail) {
    return NextResponse.json(
      { error: "Customer has no email" },
      { status: 400 },
    );
  }

  const hostedUrl = `${process.env.PUBLIC_APP_URL ?? "http://localhost:3000"}/i/${invoice.hostedToken}`;
  const result = await sendMail({
    to: invoice.customerEmail,
    from:
      invoice.merchantSupportEmail ||
      (process.env.INVOICE_FROM_EMAIL ?? "invoices@paylix.local"),
    subject: `Invoice ${invoice.number} from ${invoice.merchantLegalName || "your merchant"}`,
    react: createElement(InvoiceEmail, {
      invoiceNumber: invoice.number,
      merchantName: invoice.merchantLegalName,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
      hostedUrl,
    }),
  });

  await db
    .update(invoices)
    .set(
      result.ok
        ? { emailStatus: "sent", emailSentAt: new Date(), emailError: null }
        : { emailStatus: "failed", emailError: result.error ?? "unknown" },
    )
    .where(eq(invoices.id, invoice.id));

  return NextResponse.json({ ok: result.ok, error: result.error });
}
