import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayKit — Crypto Payment Dashboard",
  description: "Accept USDC payments and subscriptions. Open source.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#07070a] text-[#f0f0f3] antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
