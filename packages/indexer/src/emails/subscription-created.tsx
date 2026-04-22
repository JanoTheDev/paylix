import { createElement } from "react";
import { BrandedEmail, EMPTY_BRANDING, type EmailBranding } from "./branding";

export interface SubscriptionCreatedEmailProps {
  productName: string;
  amountLabel: string;
  intervalLabel: string;
  branding?: EmailBranding;
}

export function SubscriptionCreatedEmail(props: SubscriptionCreatedEmailProps) {
  return createElement(
    BrandedEmail,
    { branding: props.branding ?? EMPTY_BRANDING },
    createElement("h1", { style: { fontSize: 18 } }, `Your subscription to ${props.productName} is active`),
    createElement(
      "p",
      null,
      `Your subscription to ${props.productName} is now active. You'll be charged ${props.amountLabel} ${props.intervalLabel}.`,
    ),
  );
}
