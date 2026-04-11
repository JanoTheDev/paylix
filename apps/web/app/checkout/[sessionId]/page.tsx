import { eq } from "drizzle-orm";
import { checkoutSessions, products } from "@paylix/db/schema";
import { db } from "@/lib/db";
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

  return (
    <CheckoutProviders>
      <CheckoutClient session={session} />
    </CheckoutProviders>
  );
}
