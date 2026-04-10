import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import {
  customers,
  payments,
  products,
  subscriptions,
} from "@paylix/db/schema";
import { eq, and, desc } from "drizzle-orm";
import Link from "next/link";
import CopyButton from "./copy-button";

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function truncateHash(hash: string): string {
  if (hash.length <= 10) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PaymentStatusBadge({ status }: { status: string }) {
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

function SubStatusBadge({ status }: { status: string }) {
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

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.userId, userId)))
    .limit(1);

  if (!customer) notFound();

  const [customerPayments, customerSubscriptions] = await Promise.all([
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        fee: payments.fee,
        status: payments.status,
        txHash: payments.txHash,
        createdAt: payments.createdAt,
        productName: products.name,
      })
      .from(payments)
      .leftJoin(products, eq(payments.productId, products.id))
      .where(
        and(eq(payments.customerId, id), eq(payments.userId, userId))
      )
      .orderBy(desc(payments.createdAt)),
    db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        createdAt: subscriptions.createdAt,
        nextChargeDate: subscriptions.nextChargeDate,
        productName: products.name,
      })
      .from(subscriptions)
      .leftJoin(products, eq(subscriptions.productId, products.id))
      .where(
        and(eq(subscriptions.customerId, id), eq(subscriptions.userId, userId))
      )
      .orderBy(desc(subscriptions.createdAt)),
  ]);

  const name =
    customer.firstName || customer.lastName
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
      : null;

  const metadata = customer.metadata as Record<string, string> | null;

  return (
    <div>
      <Link
        href="/customers"
        className="inline-flex items-center rounded-lg bg-transparent px-0 py-2 text-[14px] font-medium text-[#94a3b8] transition-colors hover:text-[#f0f0f3]"
      >
        <svg
          className="mr-1.5"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back to Customers
      </Link>

      <h1 className="mt-4 text-[30px] font-semibold leading-[1.15] tracking-[-0.6px] text-[#f0f0f3]">
        {name ?? "Customer"}
      </h1>

      {/* Customer Info Card */}
      <div className="mt-8 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116] p-6">
        <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.4px] text-[#f0f0f3]">
          Customer Info
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase leading-none tracking-[0.8px] text-[#64748b]">
              Name
            </div>
            <div className="mt-2 text-[14px] text-[#f0f0f3]">
              {name ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase leading-none tracking-[0.8px] text-[#64748b]">
              Email
            </div>
            <div className="mt-2 text-[14px] text-[#f0f0f3]">
              {customer.email ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase leading-none tracking-[0.8px] text-[#64748b]">
              Phone
            </div>
            <div className="mt-2 text-[14px] text-[#f0f0f3]">
              {customer.phone ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase leading-none tracking-[0.8px] text-[#64748b]">
              Wallet Address
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-[13px] text-[#f0f0f3]">
                {customer.walletAddress ?? "—"}
              </span>
              {customer.walletAddress && (
                <CopyButton text={customer.walletAddress} />
              )}
            </div>
          </div>
        </div>

        {metadata && Object.keys(metadata).length > 0 && (
          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase leading-none tracking-[0.8px] text-[#64748b]">
              Metadata
            </div>
            <div className="mt-2 space-y-1">
              {Object.entries(metadata).map(([key, value]) => (
                <div key={key} className="text-[13px]">
                  <span className="font-mono text-[#94a3b8]">{key}</span>
                  <span className="mx-2 text-[#64748b]">=</span>
                  <span className="text-[#f0f0f3]">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Payments Table */}
      <div className="mt-12">
        <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.4px] text-[#f0f0f3]">
          Payments
        </h2>
        <div className="mt-4 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116]">
          {customerPayments.length === 0 ? (
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
                  {customerPayments.map((row) => (
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
                      <td className="h-[52px] px-4 text-right font-mono text-[13px] font-medium tabular-nums text-[#f0f0f3]">
                        {formatAmount(row.amount)}
                        <USDCBadge />
                      </td>
                      <td className="h-[52px] px-4 text-right font-mono text-[13px] font-medium tabular-nums text-[#f0f0f3]">
                        {formatAmount(row.fee)}
                      </td>
                      <td className="h-[52px] px-4">
                        <PaymentStatusBadge status={row.status} />
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

      {/* Subscriptions Table */}
      <div className="mt-12">
        <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.4px] text-[#f0f0f3]">
          Subscriptions
        </h2>
        <div className="mt-4 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116]">
          {customerSubscriptions.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-[#64748b]">
              No subscriptions yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(148,163,184,0.08)]">
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
                  </tr>
                </thead>
                <tbody>
                  {customerSubscriptions.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-[rgba(148,163,184,0.06)] transition-colors hover:bg-[#0c0c10]"
                    >
                      <td className="h-[52px] px-4 text-[13px] text-[#f0f0f3]">
                        {row.productName ?? "—"}
                      </td>
                      <td className="h-[52px] px-4">
                        <SubStatusBadge status={row.status} />
                      </td>
                      <td className="h-[52px] px-4 text-[13px] text-[#94a3b8]">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="h-[52px] px-4 text-[13px] text-[#94a3b8]">
                        {row.status === "cancelled"
                          ? "—"
                          : formatDate(row.nextChargeDate)}
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
