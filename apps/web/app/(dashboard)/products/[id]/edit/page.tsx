import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { products } from "@paykit/db/schema";
import { eq, and } from "drizzle-orm";
import { EditProductClient } from "./edit-client";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { id } = await params;

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.userId, session.user.id)))
    .limit(1);

  if (!product) notFound();

  return (
    <EditProductClient
      product={{
        id: product.id,
        name: product.name,
        description: product.description ?? "",
        type: product.type,
        price: product.price,
        interval: product.interval ?? "",
        metadata: (product.metadata as Record<string, string>) ?? {},
        checkoutFields: {
          firstName: (product.checkoutFields as Record<string, boolean>)?.firstName ?? false,
          lastName: (product.checkoutFields as Record<string, boolean>)?.lastName ?? false,
          email: (product.checkoutFields as Record<string, boolean>)?.email ?? false,
          phone: (product.checkoutFields as Record<string, boolean>)?.phone ?? false,
        },
      }}
    />
  );
}
