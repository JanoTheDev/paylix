import { createElement } from "react";

export interface TrialEndingSoonEmailProps {
  productName: string;
  daysLeft: number;
  amountLabel: string;
  firstChargeDate: string;
}

export function TrialEndingSoonEmail(props: TrialEndingSoonEmailProps) {
  return createElement(
    "div",
    {
      style: {
        fontFamily: "system-ui, sans-serif",
        color: "#0b0b0f",
        lineHeight: 1.5,
      },
    },
    createElement("h1", { style: { fontSize: 18 } }, "Your trial ends soon"),
    createElement(
      "p",
      null,
      `Your trial of ${props.productName} ends in ${props.daysLeft} day${props.daysLeft === 1 ? "" : "s"}. On ${props.firstChargeDate} we'll automatically charge ${props.amountLabel}.`,
    ),
    createElement(
      "p",
      { style: { color: "#6b7280", fontSize: 13 } },
      "Make sure your wallet has enough USDC, or cancel before the trial ends to avoid the charge.",
    ),
  );
}
