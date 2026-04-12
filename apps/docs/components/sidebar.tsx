"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Getting Started" },
  { href: "/sdk-reference", label: "SDK Reference" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/free-trials", label: "Free Trials" },
  { href: "/invoices", label: "Invoices" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/webhook-verification", label: "Webhook Verification" },
  { href: "/self-hosting", label: "Self-Hosting" },
  { href: "/testnet", label: "Testnet Setup" },
  { href: "/changelog", label: "API Changelog" },
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
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map(({ href, label }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(href + "/");
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
