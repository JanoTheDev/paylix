import { desc, eq } from "drizzle-orm";
import {
  customerWallets,
  customers,
  invoices,
  payments,
  products,
  refundRequests,
  subscriptions,
} from "@paylix/db/schema";
import { db } from "@/lib/db";
import { Web3Providers } from "@/components/providers";
import {
  PortalClient,
  type PortalInvoice,
  type PortalPayment,
  type PortalRefundRequest,
  type PortalSubscription,
  type PortalWallet,
} from "./portal-client";
import { verifyPortalToken } from "@/lib/portal-tokens";

interface PortalPageProps {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ token?: string }>;
}

function PortalError({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
      <h1 className="mb-2 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-foreground-muted">{message}</p>
    </div>
  );
}

export default async function PortalPage({
  params,
  searchParams,
}: PortalPageProps) {
  const { customerId } = await params;
  const { token } = await searchParams;

  if (!token || !verifyPortalToken(token, customerId)) {
    return (
      <PortalError
        title="Portal link expired"
        message="This portal link is invalid or has expired. Please ask the merchant for a new link."
      />
    );
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    return (
      <PortalError
        title="Customer not found"
        message="This portal link is invalid or the customer no longer exists."
      />
    );
  }

  const subRows = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      nextChargeDate: subscriptions.nextChargeDate,
      onChainId: subscriptions.onChainId,
      createdAt: subscriptions.createdAt,
      productName: products.name,
      tokenSymbol: subscriptions.tokenSymbol,
      billingInterval: products.billingInterval,
      trialEndsAt: subscriptions.trialEndsAt,
      trialConversionLastError: subscriptions.trialConversionLastError,
      productId: subscriptions.productId,
      pausedBy: subscriptions.pausedBy,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(eq(subscriptions.customerId, customer.id))
    .orderBy(desc(subscriptions.createdAt));

  const payRows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      refundedCents: payments.refundedCents,
      status: payments.status,
      txHash: payments.txHash,
      token: payments.token,
      createdAt: payments.createdAt,
      productName: products.name,
    })
    .from(payments)
    .innerJoin(products, eq(payments.productId, products.id))
    .where(eq(payments.customerId, customer.id))
    .orderBy(desc(payments.createdAt))
    .limit(50);

  const invRows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
      issuedAt: invoices.issuedAt,
      hostedToken: invoices.hostedToken,
    })
    .from(invoices)
    .where(eq(invoices.customerId, customer.id))
    .orderBy(desc(invoices.issuedAt))
    .limit(100);

  const refundReqRows = await db
    .select({
      id: refundRequests.id,
      paymentId: refundRequests.paymentId,
      amount: refundRequests.amount,
      reason: refundRequests.reason,
      status: refundRequests.status,
      merchantReason: refundRequests.merchantReason,
      decidedAt: refundRequests.decidedAt,
      createdAt: refundRequests.createdAt,
    })
    .from(refundRequests)
    .where(eq(refundRequests.customerId, customer.id))
    .orderBy(desc(refundRequests.createdAt));

  const portalRefundRequests: PortalRefundRequest[] = refundReqRows.map((r) => ({
    id: r.id,
    paymentId: r.paymentId,
    amount: r.amount,
    reason: r.reason,
    status: r.status,
    merchantReason: r.merchantReason,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  const walletRows = await db
    .select()
    .from(customerWallets)
    .where(eq(customerWallets.customerId, customer.id))
    .orderBy(desc(customerWallets.isPrimary), customerWallets.createdAt);

  const portalWallets: PortalWallet[] = walletRows.map((r) => ({
    id: r.id,
    address: r.address,
    nickname: r.nickname,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
  }));

  const portalInvoices: PortalInvoice[] = invRows.map((r) => ({
    id: r.id,
    number: r.number,
    totalCents: r.totalCents,
    currency: r.currency,
    issuedAt: r.issuedAt.toISOString(),
    hostedToken: r.hostedToken,
  }));

  const portalSubs: PortalSubscription[] = subRows.map((r) => ({
    id: r.id,
    status: r.status,
    nextChargeDate: r.nextChargeDate ? r.nextChargeDate.toISOString() : null,
    onChainId: r.onChainId,
    productName: r.productName,
    tokenSymbol: r.tokenSymbol,
    billingInterval: r.billingInterval,
    createdAt: r.createdAt.toISOString(),
    trialEndsAt: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
    trialConversionLastError: r.trialConversionLastError,
    productId: r.productId,
    pausedBy: r.pausedBy,
  }));

  const portalPayments: PortalPayment[] = payRows.map((r) => ({
    id: r.id,
    amount: r.amount,
    refundedCents: r.refundedCents,
    status: r.status,
    txHash: r.txHash,
    token: r.token,
    productName: r.productName,
    createdAt: r.createdAt.toISOString(),
  }));

  const customerLabel =
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    customer.email ||
    "your account";

  return (
    <Web3Providers>
      <PortalClient
        customerLabel={customerLabel}
        customerId={customerId}
        portalToken={token}
        subscriptions={portalSubs}
        payments={portalPayments}
        invoices={portalInvoices}
        refundRequests={portalRefundRequests}
        wallets={portalWallets}
      />
    </Web3Providers>
  );
}
