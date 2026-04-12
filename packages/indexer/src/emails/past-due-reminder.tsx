import { createElement } from "react";

export interface PastDueReminderEmailProps {
  productName: string;
  tokenSymbol: string;
}

export function PastDueReminderEmail(props: PastDueReminderEmailProps) {
  return createElement(
    "div",
    {
      style: {
        fontFamily: "system-ui, sans-serif",
        color: "#0b0b0f",
        lineHeight: 1.5,
      },
    },
    createElement("h1", { style: { fontSize: 18 } }, `Action required: ${props.productName} payment failed`),
    createElement(
      "p",
      null,
      `We couldn't process the latest charge for your ${props.productName} subscription. Please ensure your wallet has sufficient ${props.tokenSymbol} to avoid interruption.`,
    ),
  );
}
