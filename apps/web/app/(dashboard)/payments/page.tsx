import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { payments, products, customers } from "@paylix/db/schema";
import { eq, and, desc } from "drizzle-orm";

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function truncateHash(hash: string): string {
  if (hash.length <= 10) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function USDCBadge() {
  return (
    <span
      style={{
        background: "#2775ca14",
        color: "#2775ca",
        border: "1px solid #2775ca33",
      }}
      className="ml-1.5 inline-block rounded-[6px] px-2.5 py-[3px] font-mono text-[11px] font-semibold leading-none"
    >
      USDC
    </span>
  );
}

export default async function PaymentsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const userId = session.user.id;

  const rows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      fee: payments.fee,
      status: payments.status,
      txHash: payments.txHash,
      createdAt: payments.createdAt,
      productName: products.name,
      productType: products.type,
      customerEmail: customers.email,
      customerWallet: customers.walletAddress,
    })
    .from(payments)
    .leftJoin(products, eq(payments.productId, products.id))
    .leftJoin(customers, eq(payments.customerId, customers.id))
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt));

  return (
    <div>
      <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.6px] text-[#f0f0f3]">
        Payments
      </h1>

      <div className="mt-8 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116]">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-[#64748b]">
            No payments yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(148,163,184,0.08)]">
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Date
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Product
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Type
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Customer
                  </th>
                  <th className="h-10 px-4 text-right text-[13px] font-medium text-[#64748b]">
                    Amount
                  </th>
                  <th className="h-10 px-4 text-right text-[13px] font-medium text-[#64748b]">
                    Fee
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Status
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Tx Hash
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[rgba(148,163,184,0.06)] transition-colors hover:bg-[#0c0c10]"
                  >
                    <td className="h-[52px] px-4 text-[13px] text-[#94a3b8]">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="h-[52px] px-4 text-[13px] text-[#f0f0f3]">
                      {row.productName ?? "—"}
                    </td>
                    <td className="h-[52px] px-4">
                      {row.productType === "subscription" ? (
                        <span
                          style={{
                            background: "#06d6a010",
                            color: "#06d6a0",
                            border: "1px solid #06d6a033",
                          }}
                          className="inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold uppercase leading-none tracking-[0.3px]"
                        >
                          Subscription
                        </span>
                      ) : (
                        <span
                          style={{
                            background: "#94a3b810",
                            color: "#94a3b8",
                            border: "1px solid #94a3b833",
                          }}
                          className="inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold uppercase leading-none tracking-[0.3px]"
                        >
                          One-time
                        </span>
                      )}
                    </td>
                    <td className="h-[52px] px-4 text-[13px] text-[#f0f0f3]">
                      {row.customerEmail ??
                        (row.customerWallet
                          ? truncateHash(row.customerWallet)
                          : "—")}
                    </td>
                    <td className="h-[52px] px-4 text-right font-mono text-[13px] font-medium tabular-nums text-[#f0f0f3]">
                      {formatAmount(row.amount)}
                      <USDCBadge />
                    </td>
                    <td className="h-[52px] px-4 text-right font-mono text-[13px] font-medium tabular-nums text-[#f0f0f3]">
                      {formatAmount(row.fee)}
                    </td>
                    <td className="h-[52px] px-4">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="h-[52px] px-4 font-mono text-[13px] text-[#94a3b8]">
                      {row.txHash ? (
                        <a
                          href={`https://sepolia.basescan.org/tx/${row.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="transition-colors hover:text-[#06d6a0]"
                        >
                          {truncateHash(row.txHash)}
                        </a>
                      ) : (
                        "—"
                      )}
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
