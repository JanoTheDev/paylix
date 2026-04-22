import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { checkoutSessions, products } from "@paylix/db/schema";
import { db } from "@/lib/db";
import { classifyRestart } from "@/lib/checkout-restart";

interface RestartPageProps {
  params: Promise<{ sessionId: string }>;
}

function NotFoundCard() {
  return (
    <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
      <div className="mb-3 text-4xl">✘</div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight">
        Checkout not found
      </h1>
      <p className="text-sm leading-relaxed text-foreground-muted">
        This restart link does not resolve to any checkout session.
      </p>
    </div>
  );
}

export default async function RestartPage({ params }: RestartPageProps) {
  const { sessionId } = await params;

  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, sessionId))
    .limit(1);

  const action = classifyRestart(
    session
      ? {
          status: session.status,
          expiresAt: session.expiresAt,
        }
      : null,
    new Date(),
  );

  if (action === "not_found") {
    return <NotFoundCard />;
  }

  if (action === "reuse") {
    redirect(`/checkout/${sessionId}`);
  }

  // action === "create_new"
  // Source session exists but is terminal. Clone it so the buyer gets a
  // fresh session tied to the same product + customer. Trial dedup still
  // runs on the downstream relay — this route does not bypass it.
  const [product] = await db
    .select({ type: products.type })
    .from(products)
    .where(eq(products.id, session.productId))
    .limit(1);

  const [newSession] = await db
    .insert(checkoutSessions)
    .values({
      organizationId: session.organizationId,
      productId: session.productId,
      customerId: session.customerId,
      merchantWallet: session.merchantWallet,
      amount: session.amount,
      networkKey: session.networkKey,
      tokenSymbol: session.tokenSymbol,
      type: product?.type ?? session.type,
      status: session.networkKey ? "active" : "awaiting_currency",
      collectCountry: session.collectCountry,
      collectTaxId: session.collectTaxId,
      successUrl: session.successUrl,
      cancelUrl: session.cancelUrl,
      metadata: session.metadata ?? {},
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      livemode: session.livemode,
    })
    .returning();

  redirect(`/checkout/${newSession.id}`);
}
