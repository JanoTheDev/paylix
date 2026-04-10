import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { payments, subscriptions } from "@paylix/db/schema";
import { eq, sum, count, and, gte, sql } from "drizzle-orm";

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function truncateTxHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-4)}`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    confirmed: { bg: "#22c55e12", text: "#22c55e", border: "#22c55e30" },
    pending: { bg: "#60a5fa12", text: "#60a5fa", border: "#60a5fa30" },
    failed: { bg: "#f8717112", text: "#f87171", border: "#f8717130" },
  };
  const s = styles[status] ?? styles.pending;

  return (
    <span
      style={{
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
      }}
      className="inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-none tracking-[0.3px]"
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default async function OverviewPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const userId = session.user.id;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [totalRevenueResult, revenue30dResult, paymentCountResult, activeSubsResult, recentPayments] =
    await Promise.all([
      db
        .select({ total: sum(payments.amount) })
        .from(payments)
        .where(and(eq(payments.userId, userId), eq(payments.status, "confirmed"))),
      db
        .select({ total: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.userId, userId),
            eq(payments.status, "confirmed"),
            gte(payments.createdAt, thirtyDaysAgo)
          )
        ),
      db
        .select({ count: count() })
        .from(payments)
        .where(eq(payments.userId, userId)),
      db
        .select({ count: count() })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active"))),
      db
        .select()
        .from(payments)
        .where(eq(payments.userId, userId))
        .orderBy(sql`${payments.createdAt} desc`)
        .limit(10),
    ]);

  const totalRevenue = Number(totalRevenueResult[0]?.total ?? 0);
  const revenue30d = Number(revenue30dResult[0]?.total ?? 0);
  const paymentCount = paymentCountResult[0]?.count ?? 0;
  const activeSubs = activeSubsResult[0]?.count ?? 0;

  return (
    <div>
      <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.6px] text-[#f0f0f3]">
        Overview
      </h1>

      {/* Stat Cards */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total Revenue" value={formatAmount(totalRevenue)} />
        <StatCard label="Revenue (30d)" value={formatAmount(revenue30d)} />
        <StatCard label="Total Payments" value={paymentCount.toLocaleString()} />
      </div>

      {/* Active subscribers - small inline stat */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Active Subscribers" value={activeSubs.toLocaleString()} />
      </div>

      {/* Recent Payments Table */}
      <div className="mt-12">
        <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.4px] text-[#f0f0f3]">
          Recent Payments
        </h2>

        <div className="mt-4 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116]">
          {recentPayments.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-[#64748b]">
              No payments yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(148,163,184,0.08)]">
                    <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                      Amount
                    </th>
                    <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                      Status
                    </th>
                    <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                      Tx Hash
                    </th>
                    <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((payment) => (
                    <tr
                      key={payment.id}
                      className="border-b border-[rgba(148,163,184,0.06)] transition-colors hover:bg-[#0c0c10]"
                    >
                      <td className="h-[52px] px-4 text-right font-mono text-[13px] font-medium tabular-nums text-[#f0f0f3]">
                        {formatAmount(payment.amount)}
                      </td>
                      <td className="h-[52px] px-4">
                        <StatusBadge status={payment.status} />
                      </td>
                      <td className="h-[52px] px-4 font-mono text-[13px] text-[#94a3b8]">
                        {payment.txHash ? truncateTxHash(payment.txHash) : "—"}
                      </td>
                      <td className="h-[52px] px-4 text-[13px] text-[#94a3b8]">
                        {payment.createdAt.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116] px-6 py-5">
      <div className="text-[11px] font-semibold uppercase leading-none tracking-[0.8px] text-[#64748b]">
        {label}
      </div>
      <div className="mt-3 font-mono text-[24px] font-semibold leading-[1.2] tracking-[-0.3px] tabular-nums text-[#f0f0f3]">
        {value}
      </div>
    </div>
  );
}
