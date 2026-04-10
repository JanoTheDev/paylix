"use client";

import dynamic from "next/dynamic";

// Dynamically import CheckoutClient with SSR disabled
// This prevents wagmi/walletconnect from trying to use indexedDB on the server
const CheckoutClient = dynamic(
  () => import("./checkout-client").then((m) => ({ default: m.CheckoutClient })),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full max-w-[480px] rounded-[16px] border border-[rgba(148,163,184,0.16)] bg-[#18181e] p-8 text-center"
        style={{ boxShadow: "0 8px 32px rgba(0, 0, 0, 0.40)" }}
      >
        <p className="text-[14px] text-[#94a3b8]">Loading checkout...</p>
      </div>
    ),
  }
);

export function CheckoutWrapper(props: React.ComponentProps<typeof CheckoutClient>) {
  return <CheckoutClient {...props} />;
}
