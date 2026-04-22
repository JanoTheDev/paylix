"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  LogOut,
  ChevronUp,
  User,
} from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { TeamSwitcher } from "@/components/team-switcher";
import { ModeToggle } from "@/components/mode-toggle";

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: LineChart },
  { href: "/products", label: "Products", icon: Package },
  { href: "/payments", label: "Payments", icon: CreditCard },
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
  const [indexerOnline, setIndexerOnline] = useState<boolean | null>(null);
  const [relayerStatus, setRelayerStatus] = useState<{
    configured: boolean;
    low: boolean;
    balanceEth: string | null;
  } | null>(null);
  const [keeperStatus, setKeeperStatus] = useState<{
    configured: boolean;
    low: boolean;
    balanceEth: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkIndexer() {
      try {
        const res = await fetch("/api/system/indexer-status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIndexerOnline(Boolean(data.online));
      } catch {
        // ignore
      }
    }

    async function checkRelayer() {
      try {
        const res = await fetch("/api/system/relayer-status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setRelayerStatus({
            configured: Boolean(data.configured),
            low: Boolean(data.low),
            balanceEth: data.balanceEth ?? null,
          });
        }
      } catch {
        // ignore
      }
    }

    async function checkKeeper() {
      try {
        const res = await fetch("/api/system/keeper-status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setKeeperStatus({
            configured: Boolean(data.configured),
            low: Boolean(data.low),
            balanceEth: data.balanceEth ?? null,
          });
        }
      } catch {
        // ignore
      }
    }

    checkIndexer();
    checkRelayer();
    checkKeeper();
    const id = setInterval(() => {
      checkIndexer();
      checkRelayer();
      checkKeeper();
    }, 30 * 1000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                active
                  ? "bg-surface-3 text-foreground"
                  : "text-foreground-muted hover:bg-surface-2 hover:text-foreground",
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
        <div className="flex items-center gap-3 text-[11px] text-foreground-dim">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                indexerOnline === null
                  ? "bg-foreground-dim"
                  : indexerOnline
                    ? "bg-success"
                    : "bg-destructive",
              )}
            />
            Indexer
          </span>
          {relayerStatus?.configured && (
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  relayerStatus.low ? "bg-warning" : "bg-success",
                )}
              />
              Relayer
            </span>
          )}
          {keeperStatus?.configured && (
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  keeperStatus.low ? "bg-warning" : "bg-success",
                )}
              />
              Keeper
            </span>
          )}
        </div>
      </div>

      {/* User profile */}
      <UserProfileMenu onSignOut={handleSignOut} onNavigate={onNavigate} />
    </div>
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
    <div className="relative border-t border-sidebar-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {initials || <User size={14} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {userName}
          </p>
          <p className="truncate text-[11px] text-foreground-muted">{userEmail}</p>
        </div>
        <ChevronUp
          size={14}
          className={cn(
            "flex-shrink-0 text-foreground-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-lg border border-border bg-surface-1 shadow-xl">
          <Link
            href="/user/settings"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Settings size={14} strokeWidth={1.75} />
            Account settings
          </Link>
          <div className="border-t border-border" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-rose-400 transition-colors hover:bg-surface-2"
          >
            <LogOut size={14} strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      )}
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
