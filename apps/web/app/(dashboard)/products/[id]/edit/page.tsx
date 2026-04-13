import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { products, productPrices } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { NETWORKS } from "@paylix/config/networks";
import { fromNativeUnits } from "@/lib/amounts";
import { getActiveOrgOrRedirect } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { EditProductClient } from "./edit-client";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId, livemode } = await getActiveOrgOrRedirect();

  const { id } = await params;

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), orgScope(products, { organizationId, livemode })))
    .limit(1);

  if (!product) notFound();

  const priceRows = await db
    .select()
    .from(productPrices)
    .where(
      and(
        eq(productPrices.productId, id),
        eq(productPrices.isActive, true),
      ),
    );

  const pricesForForm = priceRows.map((p) => {
    const network = NETWORKS[p.networkKey as keyof typeof NETWORKS];
    const token = (network?.tokens as Record<string, { decimals: number } | undefined>)?.[p.tokenSymbol];
    return {
      networkKey: p.networkKey,
      tokenSymbol: p.tokenSymbol,
      // Convert native units back to human-readable using the token's decimals
      amount: token ? fromNativeUnits(p.amount, token.decimals) : p.amount.toString(),
    };
  });

  return (
    <EditProductClient
      product={{
        id: product.id,
        name: product.name,
        description: product.description ?? "",
        type: product.type,
        billingInterval: product.billingInterval ?? "",
        trialDays: product.trialDays ?? null,
        trialMinutes: product.trialMinutes ?? null,
        metadata: (product.metadata as Record<string, string>) ?? {},
        checkoutFields: {
          firstName:
            (product.checkoutFields as Record<string, boolean>)?.firstName ??
            false,
          lastName:
            (product.checkoutFields as Record<string, boolean>)?.lastName ??
            false,
          email:
            (product.checkoutFields as Record<string, boolean>)?.email ?? false,
          phone:
            (product.checkoutFields as Record<string, boolean>)?.phone ?? false,
        },
        prices: pricesForForm,
      }}
    />
  );
}
