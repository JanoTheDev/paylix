import { eq, and } from "drizzle-orm";
import { checkoutSessions, products, productPrices } from "@paylix/db/schema";
import { db } from "@/lib/db";
import { NETWORKS } from "@paylix/config/networks";
import { CheckoutProviders } from "@/components/providers";
import { CheckoutClient } from "./checkout-client";

interface CheckoutPageProps {
  params: Promise<{ sessionId: string }>;
}

function CheckoutStateCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-foreground-muted">
        {description}
      </p>
    </div>
  );
}

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { sessionId } = await params;

  const [session] = await db
    .select({
      id: checkoutSessions.id,
      status: checkoutSessions.status,
      amount: checkoutSessions.amount,
      networkKey: checkoutSessions.networkKey,
      tokenSymbol: checkoutSessions.tokenSymbol,
      type: checkoutSessions.type,
      merchantWallet: checkoutSessions.merchantWallet,
      customerId: checkoutSessions.customerId,
      successUrl: checkoutSessions.successUrl,
      cancelUrl: checkoutSessions.cancelUrl,
      metadata: checkoutSessions.metadata,
      expiresAt: checkoutSessions.expiresAt,
      productId: checkoutSessions.productId,
      productName: products.name,
      productDescription: products.description,
      checkoutFields: products.checkoutFields,
      billingInterval: products.billingInterval,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .where(eq(checkoutSessions.id, sessionId));

  if (!session) {
    return (
      <CheckoutStateCard
        icon="✘"
        title="Checkout not found"
        description="This checkout session does not exist or has been removed."
      />
    );
  }

  const isExpired =
    session.status === "expired" ||
    (session.status === "active" && new Date(session.expiresAt) < new Date());

  if (isExpired) {
    return (
      <CheckoutStateCard
        icon="⏳"
        title="This checkout has expired"
        description="This payment session is no longer active. Please request a new checkout link."
      />
    );
  }

  let availablePrices: Array<{
    networkKey: string;
    tokenSymbol: string;
    tokenName: string;
    displayLabel: string;
    amount: string;
    decimals: number;
  }> = [];

  if (session.status === "awaiting_currency") {
    const priceRows = await db
      .select()
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, session.productId),
          eq(productPrices.isActive, true),
        ),
      );

    availablePrices = priceRows
      .map((p) => {
        const network = NETWORKS[p.networkKey as keyof typeof NETWORKS];
        if (!network) return null;
        const token = network.tokens[p.tokenSymbol as keyof typeof network.tokens];
        if (!token) return null;
        return {
          networkKey: p.networkKey,
          tokenSymbol: p.tokenSymbol,
          tokenName: token.name,
          displayLabel: network.displayLabel,
          amount: p.amount.toString(),
          decimals: token.decimals,
        };
      })
      .filter(
        (p): p is NonNullable<typeof p> => p !== null,
      );
  }

  return (
    <CheckoutProviders>
      <CheckoutClient session={session} availablePrices={availablePrices} />
    </CheckoutProviders>
  );
}
