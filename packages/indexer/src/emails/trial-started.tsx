import { createElement } from "react";
import { BrandedEmail, EMPTY_BRANDING, type EmailBranding } from "./branding";

export interface TrialStartedEmailProps {
  productName: string;
  trialLabel: string;
  amountLabel: string;
  firstChargeDate: string;
  branding?: EmailBranding;
}

export function TrialStartedEmail(props: TrialStartedEmailProps) {
  return createElement(
    BrandedEmail,
    { branding: props.branding ?? EMPTY_BRANDING },
    createElement("h1", { style: { fontSize: 18 } }, "Your trial has started"),
    createElement(
      "p",
      null,
      `You've started a ${props.trialLabel} free trial of ${props.productName}. You won't be charged until ${props.firstChargeDate}, when the first payment of ${props.amountLabel} will be collected automatically.`,
    ),
    createElement(
      "p",
      { style: { color: "#6b7280", fontSize: 13 } },
      "You can cancel any time before then — no charge will be made.",
    ),
  );
}
