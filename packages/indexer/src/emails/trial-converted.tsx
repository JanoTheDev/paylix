import { createElement } from "react";
import { BrandedEmail, EMPTY_BRANDING, type EmailBranding } from "./branding";

export interface TrialConvertedEmailProps {
  productName: string;
  amountLabel: string;
  chargeDate: string;
  nextChargeDate: string | null;
  txHash: string | null;
  branding?: EmailBranding;
}

export function TrialConvertedEmail(props: TrialConvertedEmailProps) {
  return createElement(
    BrandedEmail,
    { branding: props.branding ?? EMPTY_BRANDING },
    createElement(
      "h1",
      { style: { fontSize: 18 } },
      "Your trial has converted",
    ),
    createElement(
      "p",
      null,
      `Your trial of ${props.productName} ended and the first payment of ${props.amountLabel} was collected on ${props.chargeDate}.`,
    ),
    props.nextChargeDate
      ? createElement(
          "p",
          null,
          `Your next charge is scheduled for ${props.nextChargeDate}.`,
        )
      : null,
    props.txHash
      ? createElement(
          "p",
          { style: { color: "#6b7280", fontSize: 13 } },
          `Transaction: ${props.txHash}`,
        )
      : null,
  );
}
