import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { products } from "@paylix/db/schema";
import { db } from "@/lib/db";
import { getActiveOrgOrRedirect } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import ProductsView, { type ProductRow } from "./products-view";

export default async function ProductsPage() {
  const { organizationId, livemode } = await getActiveOrgOrRedirect();

  const raw = await db
    .select()
    .from(products)
    .where(orgScope(products, { organizationId, livemode }))
    .orderBy(desc(products.createdAt));

  const rows: ProductRow[] = raw.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    billingInterval: p.billingInterval,
    state: p.isActive ? "active" : "inactive",
  }));

  return <ProductsView rows={rows} />;
}
