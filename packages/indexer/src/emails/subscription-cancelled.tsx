import { createElement } from "react";
import { BrandedEmail, EMPTY_BRANDING, type EmailBranding } from "./branding";

export interface SubscriptionCancelledEmailProps {
  productName: string;
  branding?: EmailBranding;
}

export function SubscriptionCancelledEmail(props: SubscriptionCancelledEmailProps) {
  return createElement(
    BrandedEmail,
    { branding: props.branding ?? EMPTY_BRANDING },
    createElement("h1", { style: { fontSize: 18 } }, `Your subscription to ${props.productName} has been cancelled`),
    createElement(
      "p",
      null,
      `Your subscription to ${props.productName} has been cancelled. You won't be charged again.`,
    ),
  );
}
