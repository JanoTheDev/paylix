import { createElement } from "react";

export interface SubscriptionCreatedEmailProps {
  productName: string;
  amountLabel: string;
  intervalLabel: string;
}

export function SubscriptionCreatedEmail(props: SubscriptionCreatedEmailProps) {
  return createElement(
    "div",
    {
      style: {
        fontFamily: "system-ui, sans-serif",
        color: "#0b0b0f",
        lineHeight: 1.5,
      },
    },
    createElement("h1", { style: { fontSize: 18 } }, `Your subscription to ${props.productName} is active`),
    createElement(
      "p",
      null,
      `Your subscription to ${props.productName} is now active. You'll be charged ${props.amountLabel} ${props.intervalLabel}.`,
    ),
  );
}
