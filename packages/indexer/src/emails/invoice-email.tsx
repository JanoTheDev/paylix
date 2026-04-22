import { createElement } from "react";
import { BrandedEmail, EMPTY_BRANDING, type EmailBranding } from "./branding";

export interface InvoiceEmailProps {
  invoiceNumber: string;
  merchantName: string;
  totalCents: number;
  currency: string;
  hostedUrl: string;
  branding?: EmailBranding;
}

function formatMoney(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function InvoiceEmail(props: InvoiceEmailProps) {
  return createElement(
    BrandedEmail,
    { branding: props.branding ?? EMPTY_BRANDING },
    createElement("h1", { style: { fontSize: 18 } }, `Invoice ${props.invoiceNumber}`),
    createElement("p", null, `From ${props.merchantName}`),
    createElement("p", null, `Total: ${formatMoney(props.totalCents, props.currency)}`),
    createElement(
      "p",
      null,
      createElement(
        "a",
        { href: props.hostedUrl, style: { color: "#06d6a0" } },
        "View invoice",
      ),
    ),
  );
}
