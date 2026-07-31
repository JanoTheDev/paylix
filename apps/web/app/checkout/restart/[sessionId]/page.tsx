import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { RotateCcw, XCircle } from "lucide-react";
import { checkoutSessions, products } from "@paylix/db/schema";
import { db } from "@/lib/db";
import { classifyRestart } from "@/lib/checkout-restart";
import { Button } from "@/components/ui/button";

interface RestartPageProps {
  params: Promise<{ sessionId: string }>;
}

function NotFoundCard() {
  return (
    <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
      <div className="mb-3 flex justify-center">
        <XCircle size={40} strokeWidth={1.5} className="text-destructive" />
      </div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight">
        Checkout not found
      </h1>
      <p className="text-sm leading-relaxed text-foreground-muted">
        This restart link does not resolve to any checkout session.
      </p>
    </div>
  );
}

/**
 * Cloning a terminal session is a mutation, so it runs behind an explicit
 * POST (server action) rather than in the render path. A page render is not
 * guaranteed to happen once — link prefetch, a bot crawl, or a refresh would
 * each have minted an orphan checkout session.
 */
async function createRestartSession(formData: FormData) {
  "use server";

  const sessionId = String(formData.get("sessionId") ?? "");
  // Render the not-found boundary rather than returning silently — a form
  // submit that appears to do nothing is worse than an explicit dead end.
  if (!sessionId) notFound();

  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, sessionId))
    .limit(1);

  const now = new Date();
  const action = classifyRestart(
    session ? { status: session.status, expiresAt: session.expiresAt } : null,
    now,
  );

  if (action === "not_found") notFound();
  // Re-check on submit: the source session may have become reusable between
  // the render and the click.
  if (action === "reuse") redirect(`/checkout/${sessionId}`);

  // Cheap idempotency: if this buyer already restarted in the last 15 minutes
  // and that clone is still live, hand back the same session instead of
  // minting another row per click.
  const recentCutoff = new Date(now.getTime() - 15 * 60 * 1000);
  const [existing] = await db
    .select({ id: checkoutSessions.id })
    .from(checkoutSessions)
    .where(
      and(
        eq(checkoutSessions.organizationId, session.organizationId),
        eq(checkoutSessions.livemode, session.livemode),
        eq(checkoutSessions.productId, session.productId),
        session.customerId
          ? eq(checkoutSessions.customerId, session.customerId)
          : isNull(checkoutSessions.customerId),
        inArray(checkoutSessions.status, ["active", "awaiting_currency"]),
        gt(checkoutSessions.createdAt, recentCutoff),
        gt(checkoutSessions.expiresAt, now),
      ),
    )
    .orderBy(desc(checkoutSessions.createdAt))
    .limit(1);

  if (existing) redirect(`/checkout/${existing.id}`);

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

export default async function RestartPage({ params }: RestartPageProps) {
  const { sessionId } = await params;

  const [session] = await db
    .select({
      status: checkoutSessions.status,
      expiresAt: checkoutSessions.expiresAt,
    })
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

  // action === "create_new" — the source session is terminal. Ask before
  // cloning it so nothing is written on a bare GET.
  return (
    <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
      <div className="mb-3 flex justify-center">
        <RotateCcw size={40} strokeWidth={1.5} className="text-foreground-dim" />
      </div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight">
        Start a new checkout
      </h1>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The original payment session is no longer active. We&apos;ll create a
        fresh one for the same product.
      </p>
      <form action={createRestartSession} className="mt-6">
        <input type="hidden" name="sessionId" value={sessionId} />
        <Button type="submit" size="lg" className="w-full">
          Start a new checkout
        </Button>
      </form>
    </div>
  );
}
