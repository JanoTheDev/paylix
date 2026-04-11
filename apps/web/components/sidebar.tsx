"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  CreditCard,
  Link2,
  UserCircle,
  Key,
  Webhook,
  Settings,
  LogOut,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/checkout-links", label: "Checkout Links", icon: Link2 },
  { href: "/customers", label: "Customers", icon: UserCircle },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/api-keys", label: "API Keys", icon: Key },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
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

      <div className="border-t border-sidebar-border px-2 py-2">
        <div className="flex h-9 items-center gap-2.5 px-3 text-xs text-foreground-dim">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              indexerOnline === null
                ? "bg-foreground-dim"
                : indexerOnline
                  ? "bg-success"
                  : "bg-destructive",
            )}
          />
          <span>
            {indexerOnline === null
              ? "Checking indexer…"
              : indexerOnline
                ? "Indexer online"
                : "Indexer offline"}
          </span>
        </div>
        {relayerStatus && relayerStatus.configured && (
          <div className="flex h-9 items-center gap-2.5 px-3 text-xs text-foreground-dim">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                relayerStatus.low ? "bg-warning" : "bg-success",
              )}
            />
            <span>Relayer {relayerStatus.low ? "low" : "ok"}</span>
          </div>
        )}
        {keeperStatus && keeperStatus.configured && (
          <div className="flex h-9 items-center gap-2.5 px-3 text-xs text-foreground-dim">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                keeperStatus.low ? "bg-warning" : "bg-success",
              )}
            />
            <span>Keeper {keeperStatus.low ? "low" : "ok"}</span>
          </div>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 px-3 text-foreground-muted hover:text-foreground"
          onClick={handleSignOut}
        >
          <LogOut size={16} strokeWidth={1.75} />
          Sign out
        </Button>
      </div>
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
