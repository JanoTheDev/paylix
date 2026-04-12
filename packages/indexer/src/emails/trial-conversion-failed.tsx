import { createElement } from "react";

export type TrialConversionFailureReason =
  | "insufficient_balance"
  | "allowance_revoked"
  | "permit_expired"
  | "nonce_drift"
  | "unknown";

export interface TrialConversionFailedEmailProps {
  productName: string;
  reason: TrialConversionFailureReason;
  restartUrl: string;
}

const REASON_COPY: Record<TrialConversionFailureReason, string> = {
  insufficient_balance:
    "your wallet didn't have enough USDC when we tried to process the first charge",
  allowance_revoked:
    "the USDC allowance on your wallet was revoked before the trial ended",
  permit_expired:
    "the authorization signature expired before we could process the first charge",
  nonce_drift:
    "another transaction on your wallet invalidated the trial's signature",
  unknown: "an unexpected error occurred processing the first charge",
};

export function TrialConversionFailedEmail(props: TrialConversionFailedEmailProps) {
  return createElement(
    "div",
    {
      style: {
        fontFamily: "system-ui, sans-serif",
        color: "#0b0b0f",
        lineHeight: 1.5,
      },
    },
    createElement(
      "h1",
      { style: { fontSize: 18 } },
      "We couldn't start your subscription",
    ),
    createElement(
      "p",
      null,
      `Your trial of ${props.productName} ended, but we couldn't process the first charge — ${REASON_COPY[props.reason]}.`,
    ),
    createElement(
      "p",
      null,
      createElement(
        "a",
        {
          href: props.restartUrl,
          style: {
            display: "inline-block",
            backgroundColor: "#06d6a0",
            color: "#07070a",
            padding: "10px 16px",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 14,
          },
        },
        "Restart subscription",
      ),
    ),
  );
}
