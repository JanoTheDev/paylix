"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  CreditCard,
  Users,
  UserCircle,
  Key,
  Webhook,
  Settings,
  LogOut,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/subscribers", label: "Subscribers", icon: Users },
  { href: "/customers", label: "Customers", icon: UserCircle },
  { href: "/api-keys", label: "API Keys", icon: Key },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-[rgba(148,163,184,0.08)] bg-[#0c0c10]">
      <div className="flex h-14 items-center px-4">
        <span className="text-base font-semibold text-[#f0f0f3]">Paylix</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
                active
                  ? "bg-[#06d6a010] text-[#06d6a0]"
                  : "text-[#94a3b8] hover:bg-[#111116] hover:text-[#f0f0f3]"
              }`}
            >
              <Icon size={18} strokeWidth={1.5} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[rgba(148,163,184,0.08)] px-2 py-2">
        <button
          onClick={handleSignOut}
          className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-[#94a3b8] transition-colors hover:bg-[#111116] hover:text-[#f0f0f3]"
        >
          <LogOut size={18} strokeWidth={1.5} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
