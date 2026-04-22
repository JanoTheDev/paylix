import { createElement, type ReactNode } from "react";

export interface EmailBranding {
  legalName: string | null;
  logoUrl: string | null;
  supportEmail: string | null;
  invoiceFooter: string | null;
}

export const EMPTY_BRANDING: EmailBranding = {
  legalName: null,
  logoUrl: null,
  supportEmail: null,
  invoiceFooter: null,
};

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Render an email header with the merchant logo + legal name. Falls back
 * to a plain "Paylix" wordmark when the profile is empty. The logoUrl is
 * validated here so a malformed or non-HTTP(S) URL is silently dropped
 * instead of rendering a broken <img>.
 */
export function BrandingHeader({ branding }: { branding: EmailBranding }) {
  const safeLogo = safeHttpUrl(branding.logoUrl);
  const name = branding.legalName?.trim() || "Paylix";
  return createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingBottom: 16,
        borderBottom: "1px solid #e5e7eb",
        marginBottom: 24,
      },
    },
    safeLogo
      ? createElement("img", {
          src: safeLogo,
          alt: name,
          style: { height: 32, width: "auto" },
        })
      : null,
    createElement(
      "span",
      { style: { fontWeight: 600, fontSize: 14, color: "#0b0b0f" } },
      name,
    ),
  );
}

/**
 * Footer with support email + optional invoice footer text, set on the
 * merchant profile. Returns null when there's nothing to show.
 */
export function BrandingFooter({ branding }: { branding: EmailBranding }) {
  const support = branding.supportEmail?.trim();
  const footer = branding.invoiceFooter?.trim();
  if (!support && !footer) return null;
  return createElement(
    "div",
    {
      style: {
        marginTop: 28,
        paddingTop: 16,
        borderTop: "1px solid #e5e7eb",
        color: "#6b7280",
        fontSize: 12,
        lineHeight: 1.5,
      },
    },
    support
      ? createElement(
          "p",
          { style: { margin: "0 0 6px 0" } },
          "Questions? Reach us at ",
          createElement(
            "a",
            {
              href: `mailto:${support}`,
              style: { color: "#0b0b0f", textDecoration: "underline" },
            },
            support,
          ),
          ".",
        )
      : null,
    footer ? createElement("p", { style: { margin: 0 } }, footer) : null,
  );
}

/**
 * Wraps an email body with the branding header + footer so templates
 * only need to render their content. Keeps the inline-style font/color
 * defaults consistent across every template.
 */
export function BrandedEmail({
  branding,
  children,
}: {
  branding: EmailBranding;
  children?: ReactNode;
}) {
  return createElement(
    "div",
    {
      style: {
        fontFamily: "system-ui, sans-serif",
        color: "#0b0b0f",
        lineHeight: 1.5,
        maxWidth: 560,
        margin: "0 auto",
      },
    },
    createElement(BrandingHeader, { branding }),
    children,
    createElement(BrandingFooter, { branding }),
  );
}

function safeHttpUrl(input: string | null): string | null {
  if (!input) return null;
  try {
    const u = new URL(input);
    if (!SAFE_URL_PROTOCOLS.has(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
