import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { products } from "@paylix/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ProductsView, { type ProductRow } from "./products-view";

export default async function ProductsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const raw = await db
    .select()
    .from(products)
    .where(eq(products.userId, session.user.id))
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
