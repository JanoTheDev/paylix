import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { products } from "@paylix/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function TypeBadge({ type }: { type: string }) {
  const isSubscription = type === "subscription";
  return (
    <span
      style={{
        background: isSubscription ? "#60a5fa12" : "#06d6a020",
        color: isSubscription ? "#60a5fa" : "#06d6a0",
        border: `1px solid ${isSubscription ? "#60a5fa30" : "#06d6a033"}`,
      }}
      className="inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-none tracking-[0.3px]"
    >
      {isSubscription ? "Subscription" : "One-time"}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        background: active ? "#22c55e12" : "#f8717112",
        color: active ? "#22c55e" : "#f87171",
        border: `1px solid ${active ? "#22c55e30" : "#f8717130"}`,
      }}
      className="inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-none tracking-[0.3px]"
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default async function ProductsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const rows = await db
    .select()
    .from(products)
    .where(eq(products.userId, session.user.id))
    .orderBy(sql`${products.createdAt} desc`);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.6px] text-[#f0f0f3]">
          Products
        </h1>
        <Link
          href="/products/new"
          className="inline-flex items-center rounded-lg bg-[#06d6a0] px-[18px] py-2.5 text-[14px] font-medium text-[#07070a] transition-colors hover:bg-[#05bf8e] active:bg-[#04a87b]"
        >
          Create Product
        </Link>
      </div>

      <div className="mt-8 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116]">
        {rows.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[13px] text-[#64748b]">No products yet.</p>
            <Link
              href="/products/new"
              className="mt-4 inline-flex items-center rounded-lg bg-transparent px-[18px] py-2.5 text-[14px] font-medium text-[#94a3b8] transition-colors hover:bg-[#111116] hover:text-[#f0f0f3]"
            >
              Create your first product
            </Link>
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
                    Type
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Price
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Interval
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Status
                  </th>
                  <th className="h-10 px-4 text-right text-[13px] font-medium text-[#64748b]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b border-[rgba(148,163,184,0.06)] transition-colors hover:bg-[#0c0c10]"
                  >
                    <td className="h-[52px] px-4 text-[13px] text-[#f0f0f3]">
                      {product.name}
                    </td>
                    <td className="h-[52px] px-4">
                      <TypeBadge type={product.type} />
                    </td>
                    <td className="h-[52px] px-4 font-mono text-[13px] font-medium tabular-nums text-[#f0f0f3]">
                      {formatAmount(product.price)}
                    </td>
                    <td className="h-[52px] px-4 text-[13px] text-[#94a3b8]">
                      {product.interval
                        ? product.interval.charAt(0).toUpperCase() +
                          product.interval.slice(1)
                        : "—"}
                    </td>
                    <td className="h-[52px] px-4">
                      <ActiveBadge active={product.isActive} />
                    </td>
                    <td className="h-[52px] px-4 text-right">
                      <Link
                        href={`/products/${product.id}/edit`}
                        className="inline-flex items-center rounded-lg bg-transparent px-3 py-1.5 text-[13px] text-[#94a3b8] transition-colors hover:bg-[#111116] hover:text-[#f0f0f3]"
                      >
                        Edit
                      </Link>
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
