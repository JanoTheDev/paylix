import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { customers, payments } from "@paylix/db/schema";
import { eq, and, sql, desc, count, sum, max } from "drizzle-orm";
import Link from "next/link";
import PortalLinkButton from "./portal-link-button";

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function CustomersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const userId = session.user.id;

  const rows = await db
    .select({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      email: customers.email,
      walletAddress: customers.walletAddress,
      totalSpent: sum(
        sql`CASE WHEN ${payments.status} = 'confirmed' THEN ${payments.amount} ELSE 0 END`
      ),
      paymentCount: count(payments.id),
      lastPayment: max(payments.createdAt),
    })
    .from(customers)
    .leftJoin(payments, eq(customers.id, payments.customerId))
    .where(eq(customers.userId, userId))
    .groupBy(customers.id)
    .orderBy(desc(customers.createdAt));

  return (
    <div>
      <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.6px] text-[#f0f0f3]">
        Customers
      </h1>

      <div className="mt-8 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116]">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-[#64748b]">
            No customers yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(148,163,184,0.08)]">
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Name
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Email
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Wallet
                  </th>
                  <th className="h-10 px-4 text-right text-[13px] font-medium text-[#64748b]">
                    Total Spent
                  </th>
                  <th className="h-10 px-4 text-right text-[13px] font-medium text-[#64748b]">
                    Payments
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Last Payment
                  </th>
                  <th className="h-10 px-4 text-right text-[13px] font-medium text-[#64748b]">
                    Portal
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name =
                    row.firstName || row.lastName
                      ? [row.firstName, row.lastName].filter(Boolean).join(" ")
                      : "—";

                  return (
                    <tr key={row.id}>
                      <td colSpan={7} className="p-0">
                        <div className="relative flex border-b border-[rgba(148,163,184,0.06)] transition-colors hover:bg-[#0c0c10]">
                          <Link
                            href={`/customers/${row.id}`}
                            className="flex h-[52px] flex-1 items-center"
                          >
                            <span className="w-0 flex-1 truncate px-4 text-[13px] text-[#f0f0f3]">
                              {name}
                            </span>
                            <span className="w-0 flex-1 truncate px-4 text-[13px] text-[#f0f0f3]">
                              {row.email ?? "—"}
                            </span>
                            <span className="w-0 flex-1 truncate px-4 font-mono text-[13px] text-[#94a3b8]">
                              {row.walletAddress
                                ? truncateAddress(row.walletAddress)
                                : "—"}
                            </span>
                            <span className="w-0 flex-1 truncate px-4 text-right font-mono text-[13px] font-medium tabular-nums text-[#f0f0f3]">
                              {formatAmount(Number(row.totalSpent ?? 0))}
                            </span>
                            <span className="w-0 flex-1 truncate px-4 text-right font-mono text-[13px] tabular-nums text-[#f0f0f3]">
                              {row.paymentCount}
                            </span>
                            <span className="w-0 flex-1 truncate px-4 text-[13px] text-[#94a3b8]">
                              {formatDate(
                                row.lastPayment
                                  ? new Date(row.lastPayment)
                                  : null
                              )}
                            </span>
                          </Link>
                          <div className="flex h-[52px] w-0 flex-1 items-center justify-end px-4">
                            <PortalLinkButton customerUuid={row.id} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
