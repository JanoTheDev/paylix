import { createElement } from "react";
import { BrandedEmail, EMPTY_BRANDING, type EmailBranding } from "./branding";

export interface PaymentReceiptEmailProps {
  productName: string;
  amountLabel: string;
  nextChargeDate: string;
  branding?: EmailBranding;
}

export function PaymentReceiptEmail(props: PaymentReceiptEmailProps) {
  return createElement(
    BrandedEmail,
    { branding: props.branding ?? EMPTY_BRANDING },
    createElement("h1", { style: { fontSize: 18 } }, `Payment receipt for ${props.productName}`),
    createElement(
      "p",
      null,
      `We've charged ${props.amountLabel} for your ${props.productName} subscription. Next charge on ${props.nextChargeDate}.`,
    ),
  );
}
