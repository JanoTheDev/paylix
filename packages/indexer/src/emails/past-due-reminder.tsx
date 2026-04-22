import { createElement } from "react";
import { BrandedEmail, EMPTY_BRANDING, type EmailBranding } from "./branding";

export interface PastDueReminderEmailProps {
  productName: string;
  tokenSymbol: string;
  branding?: EmailBranding;
}

export function PastDueReminderEmail(props: PastDueReminderEmailProps) {
  return createElement(
    BrandedEmail,
    { branding: props.branding ?? EMPTY_BRANDING },
    createElement("h1", { style: { fontSize: 18 } }, `Action required: ${props.productName} payment failed`),
    createElement(
      "p",
      null,
      `We couldn't process the latest charge for your ${props.productName} subscription. Please ensure your wallet has sufficient ${props.tokenSymbol} to avoid interruption.`,
    ),
  );
}
