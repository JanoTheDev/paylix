"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  Package,
  CreditCard,
  Link2,
  Tag,
  UserCircle,
  Key,
  Webhook,
  Settings,
  Shield,
  Ban,
  RotateCcw,
  LogOut,
  ChevronUp,
  User,
} from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TeamSwitcher } from "@/components/team-switcher";
import { ModeToggle } from "@/components/mode-toggle";
import { useSystemStatus } from "@/components/system-status/use-system-status";

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: LineChart },
  { href: "/products", label: "Products", icon: Package },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/refund-requests", label: "Refund Requests", icon: RotateCcw },
  { href: "/checkout-links", label: "Checkout Links", icon: Link2 },
  { href: "/payment-links", label: "Payment Links", icon: Link2 },
  { href: "/coupons", label: "Coupons", icon: Tag },
  { href: "/customers", label: "Customers", icon: UserCircle },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/api-keys", label: "API Keys", icon: Key },
  { href: "/blocklist", label: "Blocklist", icon: Ban },
  { href: "/audit-log", label: "Audit Log", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarContent({
  onNavigate,
  mode = "test",
}: {
  onNavigate?: () => void;
  mode?: "test" | "live";
}) {
  const pathname = usePathname();
  const router = useRouter();
  // One shared poll for the whole app. `SidebarContent` renders twice on
  // mobile-capable viewports (desktop aside + MobileNav sheet); the store
  // keeps that to a single timer (UI-40).
  const { indexerOnline, relayer: relayerStatus, keeper: keeperStatus } =
    useSystemStatus();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-14 items-center border-b border-sidebar-border px-5">
        <Link
          href="/overview"
          onClick={onNavigate}
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Paylix
        </Link>
      </div>

      <div className="px-2 py-2">
        <TeamSwitcher />
      </div>

      <div className="px-2 pb-2">
        <ModeToggle mode={mode} />
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                active
                  ? "bg-primary/10 text-primary [&_svg]:text-primary"
                  : "text-foreground-muted hover:bg-surface-1 hover:text-foreground",
              )}
            >
              <Icon size={16} strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* System status — compact inline */}
      <div className="border-t border-sidebar-border px-4 py-2">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 text-[11px] text-foreground-dim"
        >
          <ServiceDot
            label="Indexer"
            tone={
              indexerOnline === null
                ? "unknown"
                : indexerOnline
                  ? "ok"
                  : "down"
            }
            state={
              indexerOnline === null
                ? "checking"
                : indexerOnline
                  ? "online"
                  : "offline"
            }
          />
          {relayerStatus?.configured && (
            <ServiceDot
              label="Relayer"
              tone={relayerStatus.low ? "warn" : "ok"}
              state={relayerStatus.low ? "low balance" : "funded"}
            />
          )}
          {keeperStatus?.configured && (
            <ServiceDot
              label="Keeper"
              tone={keeperStatus.low ? "warn" : "ok"}
              state={keeperStatus.low ? "low balance" : "funded"}
            />
          )}
        </div>
      </div>

      {/* User profile */}
      <UserProfileMenu onSignOut={handleSignOut} onNavigate={onNavigate} />
    </div>
  );
}

const DOT_TONE = {
  ok: "bg-success",
  warn: "bg-warning",
  down: "bg-destructive",
  unknown: "bg-foreground-dim",
} as const;

/**
 * A service health indicator. The coloured dot is decorative — the state word
 * is always exposed to assistive tech so status is never colour-only
 * (DESIGN.md §7).
 */
function ServiceDot({
  label,
  tone,
  state,
}: {
  label: string;
  tone: keyof typeof DOT_TONE;
  state: string;
}) {
  return (
    <span className="flex items-center gap-1.5" title={`${label}: ${state}`}>
      <span
        aria-hidden="true"
        className={cn("inline-block h-1.5 w-1.5 rounded-full", DOT_TONE[tone])}
      />
      {label}
      <span className="sr-only">{state}</span>
    </span>
  );
}

function UserProfileMenu({
  onSignOut,
  onNavigate,
}: {
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  const userName = session?.user?.name ?? "Account";
  const userEmail = session?.user?.email ?? "";
  const initials = userName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="border-t border-sidebar-border">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className={cn(
            "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-1",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          )}
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initials || <User size={14} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {userName}
            </p>
            <p className="truncate text-[11px] text-foreground-muted">
              {userEmail}
            </p>
          </div>
          <ChevronUp
            size={14}
            className={cn(
              "flex-shrink-0 text-foreground-muted transition-transform",
              open && "rotate-180",
            )}
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="top"
          align="start"
          className="w-[calc(var(--radix-dropdown-menu-trigger-width)-16px)]"
        >
          <DropdownMenuItem asChild>
            <Link href="/user/settings" onClick={onNavigate}>
              <Settings size={14} strokeWidth={1.75} />
              Account settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onSignOut()}>
            <LogOut size={14} strokeWidth={1.75} />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function Sidebar({ mode = "test" }: { mode?: "test" | "live" }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border lg:block">
      <SidebarContent mode={mode} />
    </aside>
  );
}
