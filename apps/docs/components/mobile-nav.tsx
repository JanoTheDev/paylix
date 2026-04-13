"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

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
      { href: "/invoices", label: "Invoices" },
      { href: "/email-notifications", label: "Email Notifications" },
      { href: "/webhooks", label: "Webhooks" },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/self-hosting", label: "Self-Hosting" },
      { href: "/test-mode", label: "Test Mode" },
      { href: "/testnet", label: "Testnet Setup" },
      { href: "/audit-logs", label: "Audit Logs" },
      { href: "/changelog", label: "API Changelog" },
      { href: "/webhook-verification", label: "Webhook Verification" },
    ],
  },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background px-4 lg:hidden">
        <Link href="/" className="text-base font-semibold">
          Paylix Docs
        </Link>
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close navigation" : "Open navigation"}
          className="inline-flex size-10 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-2 hover:text-foreground"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 top-14 z-20 overflow-y-auto bg-background lg:hidden">
          <nav className="px-2 py-4">
            {navGroups.map((entry) => {
              if ("href" in entry) {
                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex h-11 items-center rounded-lg px-4 text-sm transition-colors",
                      isActive(entry.href)
                        ? "bg-surface-3 text-foreground"
                        : "text-foreground-muted hover:bg-surface-2 hover:text-foreground",
                    )}
                  >
                    {entry.label}
                  </Link>
                );
              }

              return (
                <div key={entry.group} className="pt-5 first:pt-0">
                  <span className="px-4 text-xs font-medium uppercase tracking-wider text-foreground-muted/60">
                    {entry.group}
                  </span>
                  <div className="mt-1.5 space-y-0.5">
                    {entry.items.map(({ href, label }) => (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex h-11 items-center rounded-lg px-4 text-sm transition-colors",
                          isActive(href)
                            ? "bg-surface-3 text-foreground"
                            : "text-foreground-muted hover:bg-surface-2 hover:text-foreground",
                        )}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
