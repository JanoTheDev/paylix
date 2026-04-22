"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SearchDialog } from "./search-dialog";

type NavItem = { href: string; label: string };
type NavGroup = { group: string; items: NavItem[] };

const navGroups: (NavItem | NavGroup)[] = [
  { href: "/", label: "Getting Started" },
  {
    group: "API Reference",
    items: [
      { href: "/sdk-reference", label: "SDK Overview" },
      { href: "/sdk-reference/checkout", label: "Checkout & Verification" },
      { href: "/sdk-reference/payments", label: "Payments" },
      { href: "/sdk-reference/subscriptions", label: "Subscriptions" },
      { href: "/sdk-reference/portal", label: "Portal & Invoices" },
      { href: "/sdk-reference/webhooks", label: "Webhook Management" },
      { href: "/sdk-reference/coupons", label: "Coupons" },
      { href: "/sdk-reference/payment-links", label: "Payment Links" },
      { href: "/sdk-reference/blocklist", label: "Blocklist" },
      { href: "/products", label: "Products" },
      { href: "/customers", label: "Customers" },
      { href: "/error-codes", label: "Error Codes" },
      { href: "/rate-limits", label: "Rate Limits" },
    ],
  },
  {
    group: "Frameworks",
    items: [
      { href: "/frameworks", label: "Overview" },
      { href: "/frameworks/nextjs-app-router", label: "Next.js (App Router)" },
      { href: "/frameworks/nextjs-pages-router", label: "Next.js (Pages Router)" },
      { href: "/frameworks/react-vite", label: "React (Vite)" },
      { href: "/frameworks/sveltekit", label: "SvelteKit" },
      { href: "/frameworks/nuxt", label: "Nuxt 3" },
      { href: "/frameworks/remix", label: "Remix" },
      { href: "/frameworks/express", label: "Express / Fastify" },
    ],
  },
  {
    group: "Features",
    items: [
      { href: "/subscriptions", label: "Subscriptions" },
      { href: "/free-trials", label: "Free Trials" },
      { href: "/coupons", label: "Coupons" },
      { href: "/payment-links", label: "Payment Links" },
      { href: "/analytics", label: "Analytics" },
      { href: "/invoices", label: "Invoices" },
      { href: "/email-notifications", label: "Email Notifications" },
      { href: "/branding", label: "Branding" },
      { href: "/blocklist", label: "Blocklist" },
      { href: "/scheduled-cancellation", label: "Scheduled Cancellation" },
      { href: "/gift-subscriptions", label: "Gift Subscriptions" },
      { href: "/csv-export", label: "CSV Export" },
      { href: "/webhooks", label: "Webhooks" },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/self-hosting", label: "Self-Hosting" },
      { href: "/test-mode", label: "Test Mode" },
      { href: "/testnet", label: "Testnet Setup" },
      { href: "/api-keys", label: "API Keys" },
      { href: "/audit-logs", label: "Audit Logs" },
      { href: "/changelog", label: "API Changelog" },
      { href: "/webhook-verification", label: "Webhook Verification" },
    ],
  },
];

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-14 items-center border-b border-sidebar-border px-5">
        <Link
          href="/"
          onClick={onNavigate}
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Paylix Docs
        </Link>
      </div>
      <div className="border-b border-sidebar-border px-3 py-3">
        <SearchDialog />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {navGroups.map((entry) => {
          if ("href" in entry) {
            const active =
              entry.href === "/"
                ? pathname === "/"
                : pathname === entry.href ||
                  pathname.startsWith(entry.href + "/");
            return (
              <Link
                key={entry.href}
                href={entry.href}
                onClick={onNavigate}
                className={cn(
                  "flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                  active
                    ? "bg-surface-3 text-foreground"
                    : "text-foreground-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {entry.label}
              </Link>
            );
          }

          return (
            <div key={entry.group} className="pt-4 first:pt-0">
              <span className="px-3 text-xs font-medium uppercase tracking-wider text-foreground-muted/60">
                {entry.group}
              </span>
              <div className="mt-1 space-y-0.5">
                {entry.items.map(({ href, label }) => {
                  const active =
                    pathname === href ||
                    pathname.startsWith(href + "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onNavigate}
                      className={cn(
                        "flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                        active
                          ? "bg-surface-3 text-foreground"
                          : "text-foreground-muted hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border lg:block">
      <SidebarContent />
    </aside>
  );
}
