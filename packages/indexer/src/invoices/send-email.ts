import { createDb } from "@paylix/db/client";
import { invoices } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { sendMail } from "@paylix/mailer";
import { createElement } from "react";
import { config } from "../config";
import { dispatchWebhooks } from "../webhook-dispatch";
import { notificationsEnabled } from "../emails/notifications-enabled";

const db = createDb(config.databaseUrl);

export interface SendInvoiceEmailArgs {
  invoiceId: string;
  organizationId: string;
}

export async function sendInvoiceEmail(args: SendInvoiceEmailArgs) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, args.invoiceId))
    .limit(1);
  if (!invoice) return;
  if (invoice.emailStatus !== "pending") return;

  if (!(await notificationsEnabled(args.organizationId))) {
    await db
      .update(invoices)
      .set({
        emailStatus: "skipped",
        emailError: "notifications disabled by merchant",
      })
      .where(eq(invoices.id, invoice.id));
    return;
  }

  if (!invoice.customerEmail) {
    await db
      .update(invoices)
      .set({ emailStatus: "skipped", emailError: "no customer email" })
      .where(eq(invoices.id, invoice.id));
    return;
  }

  const hostedUrl = `${config.publicAppUrl}/i/${invoice.hostedToken}`;

  // Dynamic import so the indexer doesn't pull React at module-eval time.
  const { InvoiceEmail } = await import("../emails/invoice-email");

  const result = await sendMail({
    to: invoice.customerEmail,
    from: invoice.merchantSupportEmail || config.defaultFromEmail,
    subject: `Invoice ${invoice.number} from ${invoice.merchantLegalName || "your merchant"}`,
    react: createElement(InvoiceEmail, {
      invoiceNumber: invoice.number,
      merchantName: invoice.merchantLegalName,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
      hostedUrl,
    }),
  });

  if (result.ok) {
    await db
      .update(invoices)
      .set({ emailStatus: "sent", emailSentAt: new Date(), emailError: null })
      .where(eq(invoices.id, invoice.id));
    await dispatchWebhooks(args.organizationId, "invoice.email_sent", {
      invoiceId: invoice.id,
      number: invoice.number,
    });
  } else {
    await db
      .update(invoices)
      .set({ emailStatus: "failed", emailError: result.error ?? "unknown" })
      .where(eq(invoices.id, invoice.id));
    await dispatchWebhooks(args.organizationId, "invoice.email_failed", {
      invoiceId: invoice.id,
      number: invoice.number,
      error: result.error,
    });
  }
}
