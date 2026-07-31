import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { Toc } from "@/components/toc";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Paylix Docs", template: "%s — Paylix Docs" },
  description:
    "Accept one-time and recurring crypto payments in your app with a few lines of TypeScript. USDC, USDT, DAI and more, across 7 EVM chains.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <MobileNav />
        <Sidebar />
        <div className="min-h-screen lg:ml-60">
          <div className="mx-auto flex min-h-screen max-w-[1400px]">
            <main className="mx-auto w-full max-w-[880px] flex-1 px-6 py-12 sm:px-10 xl:mx-0">
              {children}
            </main>
            <aside className="sticky top-12 hidden h-[calc(100vh-6rem)] w-[240px] flex-shrink-0 overflow-y-auto px-6 py-0 xl:block">
              <Toc />
            </aside>
          </div>
        </div>
      </body>
    </html>
  );
}
