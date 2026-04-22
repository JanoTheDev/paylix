import { createElement } from "react";
import { BrandedEmail, EMPTY_BRANDING, type EmailBranding } from "./branding";

export interface CheckoutAbandonedEmailProps {
  productName: string;
  restartUrl: string;
  merchantName: string | null;
  branding?: EmailBranding;
}

export function CheckoutAbandonedEmail(props: CheckoutAbandonedEmailProps) {
  return createElement(
    BrandedEmail,
    { branding: props.branding ?? EMPTY_BRANDING },
    createElement("h1", { style: { fontSize: 18 } }, "Still interested?"),
    createElement(
      "p",
      null,
      `You left your ${props.productName} checkout before finishing. Your session is saved — pick up where you left off:`,
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
            padding: "10px 16px",
            borderRadius: 8,
            background: "#06d6a0",
            color: "#07070a",
            textDecoration: "none",
            fontWeight: 600,
          },
        },
        "Resume checkout",
      ),
    ),
  );
}
