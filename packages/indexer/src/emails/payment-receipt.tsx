import { createElement } from "react";

export interface PaymentReceiptEmailProps {
  productName: string;
  amountLabel: string;
  nextChargeDate: string;
}

export function PaymentReceiptEmail(props: PaymentReceiptEmailProps) {
  return createElement(
    "div",
    {
      style: {
        fontFamily: "system-ui, sans-serif",
        color: "#0b0b0f",
        lineHeight: 1.5,
      },
    },
    createElement("h1", { style: { fontSize: 18 } }, `Payment receipt for ${props.productName}`),
    createElement(
      "p",
      null,
      `We've charged ${props.amountLabel} for your ${props.productName} subscription. Next charge on ${props.nextChargeDate}.`,
    ),
  );
}
