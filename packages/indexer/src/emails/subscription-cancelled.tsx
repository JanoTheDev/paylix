import { createElement } from "react";

export interface SubscriptionCancelledEmailProps {
  productName: string;
}

export function SubscriptionCancelledEmail(props: SubscriptionCancelledEmailProps) {
  return createElement(
    "div",
    {
      style: {
        fontFamily: "system-ui, sans-serif",
        color: "#0b0b0f",
        lineHeight: 1.5,
      },
    },
    createElement("h1", { style: { fontSize: 18 } }, `Your subscription to ${props.productName} has been cancelled`),
    createElement(
      "p",
      null,
      `Your subscription to ${props.productName} has been cancelled. You won't be charged again.`,
    ),
  );
}
