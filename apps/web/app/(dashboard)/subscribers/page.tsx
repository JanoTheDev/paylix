import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { subscriptions, products, customers } from "@paylix/db/schema";
import { eq, desc } from "drizzle-orm";
import CancelButton from "./cancel-button";

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    active: { bg: "#22c55e12", text: "#22c55e", border: "#22c55e30" },
    past_due: { bg: "#fbbf2412", text: "#fbbf24", border: "#fbbf2430" },
    cancelled: { bg: "#f8717112", text: "#f87171", border: "#f8717130" },
    expired: { bg: "#f8717112", text: "#f87171", border: "#f8717130" },
  };
  const s = styles[status] ?? styles.active;

  const label: Record<string, string> = {
    active: "Active",
    past_due: "Past Due",
    cancelled: "Cancelled",
    expired: "Expired",
  };

  return (
    <span
      style={{
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
      }}
      className="inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-none tracking-[0.3px]"
    >
      {label[status] ?? status}
    </span>
  );
}

export default async function SubscribersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const userId = session.user.id;

  const rows = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      createdAt: subscriptions.createdAt,
      nextChargeDate: subscriptions.nextChargeDate,
      productName: products.name,
      customerEmail: customers.email,
      customerWallet: customers.walletAddress,
    })
    .from(subscriptions)
    .leftJoin(products, eq(subscriptions.productId, products.id))
    .leftJoin(customers, eq(subscriptions.customerId, customers.id))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));

  return (
    <div>
      <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.6px] text-[#f0f0f3]">
        Subscribers
      </h1>

      <div className="mt-8 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116]">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-[#64748b]">
            No subscribers yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(148,163,184,0.08)]">
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Customer
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Plan
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Status
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Started
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Next Charge
                  </th>
                  <th className="h-10 px-4 text-right text-[13px] font-medium text-[#64748b]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[rgba(148,163,184,0.06)] transition-colors hover:bg-[#0c0c10]"
                  >
                    <td className="h-[52px] px-4 text-[13px] text-[#f0f0f3]">
                      {row.customerEmail ?? (
                        <span className="font-mono text-[13px]">
                          {row.customerWallet
                            ? truncateAddress(row.customerWallet)
                            : "—"}
                        </span>
                      )}
                    </td>
                    <td className="h-[52px] px-4 text-[13px] text-[#f0f0f3]">
                      {row.productName ?? "—"}
                    </td>
                    <td className="h-[52px] px-4">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="h-[52px] px-4 text-[13px] text-[#94a3b8]">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="h-[52px] px-4 text-[13px] text-[#94a3b8]">
                      {row.status === "cancelled"
                        ? "—"
                        : formatDate(row.nextChargeDate)}
                    </td>
                    <td className="h-[52px] px-4 text-right">
                      {row.status === "active" || row.status === "past_due" ? (
                        <CancelButton subscriptionId={row.id} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
