import { db } from "@/lib/db";
import { checkoutSessions, products } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { CheckoutWrapper } from "./checkout-wrapper";

interface CheckoutPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { sessionId } = await params;

  const [session] = await db
    .select({
      id: checkoutSessions.id,
      status: checkoutSessions.status,
      amount: checkoutSessions.amount,
      currency: checkoutSessions.currency,
      chain: checkoutSessions.chain,
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
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .where(eq(checkoutSessions.id, sessionId));

  if (!session) {
    return (
      <div
        className="w-full max-w-[480px] rounded-[16px] border border-[rgba(148,163,184,0.16)] bg-[#18181e] p-8 text-center"
        style={{ boxShadow: "0 8px 32px rgba(0, 0, 0, 0.40)" }}
      >
        <div className="mb-3 text-[40px]">&#x2718;</div>
        <h1 className="mb-2 text-[20px] font-semibold tracking-[-0.4px] text-[#f0f0f3]">
          Checkout not found
        </h1>
        <p className="text-[14px] leading-[1.55] text-[#94a3b8]">
          This checkout session does not exist or has been removed.
        </p>
      </div>
    );
  }

  // Check if expired
  const isExpired =
    session.status === "expired" ||
    (session.status === "active" && new Date(session.expiresAt) < new Date());

  if (isExpired) {
    return (
      <div
        className="w-full max-w-[480px] rounded-[16px] border border-[rgba(148,163,184,0.16)] bg-[#18181e] p-8 text-center"
        style={{ boxShadow: "0 8px 32px rgba(0, 0, 0, 0.40)" }}
      >
        <div className="mb-3 text-[40px] text-[#fbbf24]">&#x23F3;</div>
        <h1 className="mb-2 text-[20px] font-semibold tracking-[-0.4px] text-[#f0f0f3]">
          This checkout has expired
        </h1>
        <p className="text-[14px] leading-[1.55] text-[#94a3b8]">
          This payment session is no longer active. Please request a new checkout link.
        </p>
      </div>
    );
  }

  return <CheckoutWrapper session={session} />;
}
