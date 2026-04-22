import type { Invoice, InvoiceLineItem } from "@paylix/db/schema";

interface Props {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  downloadHref: string;
  receiptHref?: string;
}

function money(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function HostedInvoice({ invoice, lineItems, downloadHref, receiptHref }: Props) {
  return (
    <div className="mx-auto max-w-[720px] p-8">
      <header className="flex items-start justify-between gap-8 border-b border-border pb-6">
        <div>
          {invoice.merchantLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={invoice.merchantLogoUrl}
              alt={invoice.merchantLegalName}
              className="mb-4 h-12"
            />
          )}
          <div className="font-mono text-sm text-foreground-muted">
            {invoice.merchantLegalName}
          </div>
          <div className="mt-1 whitespace-pre-line text-xs text-foreground-muted">
            {[
              invoice.merchantAddressLine1,
              invoice.merchantAddressLine2,
              `${invoice.merchantCity} ${invoice.merchantPostalCode}`,
              invoice.merchantCountry,
            ]
              .filter(Boolean)
              .join("\n")}
          </div>
          {invoice.merchantTaxId && (
            <div className="mt-1 font-mono text-xs text-foreground-muted">
              Tax ID: {invoice.merchantTaxId}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-foreground-muted">
            Invoice
          </div>
          <div className="font-mono text-lg">{invoice.number}</div>
          <div className="mt-2 text-xs text-foreground-muted">
            Issued {new Date(invoice.issuedAt).toLocaleDateString()}
          </div>
          <div className="mt-4 flex flex-col items-end gap-1.5">
            <a
              href={downloadHref}
              className="inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
            >
              Download invoice
            </a>
            {receiptHref && (
              <a
                href={receiptHref}
                className="inline-block rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
              >
                Download receipt
              </a>
            )}
          </div>
        </div>
      </header>

      <section className="mt-6">
        <div className="text-xs uppercase tracking-wide text-foreground-muted">
          Bill to
        </div>
        <div className="mt-1 text-sm">{invoice.customerName ?? "—"}</div>
        {invoice.customerEmail && (
          <div className="text-xs text-foreground-muted">{invoice.customerEmail}</div>
        )}
        {invoice.customerCountry && (
          <div className="text-xs text-foreground-muted">{invoice.customerCountry}</div>
        )}
        {invoice.customerTaxId && (
          <div className="font-mono text-xs text-foreground-muted">
            Tax ID: {invoice.customerTaxId}
          </div>
        )}
      </section>

      <table className="mt-8 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-foreground-muted">
            <th className="py-2 text-left">Description</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((li) => (
            <tr key={li.id} className="border-b border-border/60">
              <td className="py-3">{li.description}</td>
              <td className="py-3 text-right font-mono">{li.quantity}</td>
              <td className="py-3 text-right font-mono">
                {money(li.unitAmountCents, invoice.currency)}
              </td>
              <td className="py-3 text-right font-mono">
                {money(li.amountCents, invoice.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 ml-auto w-64 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-foreground-muted">Subtotal</span>
          <span className="font-mono">
            {money(invoice.subtotalCents, invoice.currency)}
          </span>
        </div>
        {invoice.taxLabel && (
          <div className="flex justify-between">
            <span className="text-foreground-muted">{invoice.taxLabel}</span>
            <span className="font-mono">{money(invoice.taxCents, invoice.currency)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-2 text-base font-medium">
          <span>Total</span>
          <span className="font-mono">{money(invoice.totalCents, invoice.currency)}</span>
        </div>
      </div>

      {(invoice.merchantFooter || invoice.merchantSupportEmail) && (
        <footer className="mt-12 space-y-2 border-t border-border pt-6 text-xs text-foreground-muted">
          {invoice.merchantSupportEmail && (
            <div>
              Questions? Reach us at{" "}
              <a
                href={`mailto:${invoice.merchantSupportEmail}`}
                className="font-mono text-foreground underline"
              >
                {invoice.merchantSupportEmail}
              </a>
              .
            </div>
          )}
          {invoice.merchantFooter && (
            <div className="whitespace-pre-line">{invoice.merchantFooter}</div>
          )}
        </footer>
      )}
    </div>
  );
}
