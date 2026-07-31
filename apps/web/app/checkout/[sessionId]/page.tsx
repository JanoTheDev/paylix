import type { ReactNode } from "react";
import { eq, and } from "drizzle-orm";
import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import { checkoutSessions, products, productPrices, coupons } from "@paylix/db/schema";
import { db } from "@/lib/db";
import { NETWORKS } from "@paylix/config/networks";
import { CheckoutProviders } from "@/components/providers";
import { CheckoutClient } from "./checkout-client";
import { SolanaProviders } from "@/components/solana-providers";
import { resolveDeploymentForMode } from "@/lib/deployment";
import {
  UTXO_BUYER_NOTICE,
  UTXO_PAYMENTS_ENABLED,
  isUtxoNetwork,
} from "@/app/_lib/utxo-payments";

interface CheckoutPageProps {
  params: Promise<{ sessionId: string }>;
}

function CheckoutStateCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
      <div className="mb-3 flex justify-center">{icon}</div>
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
      collectCountry: checkoutSessions.collectCountry,
      collectTaxId: checkoutSessions.collectTaxId,
      productName: products.name,
      productDescription: products.description,
      checkoutFields: products.checkoutFields,
      billingInterval: products.billingInterval,
      trialDays: products.trialDays,
      trialMinutes: products.trialMinutes,
      livemode: checkoutSessions.livemode,
      appliedCouponId: checkoutSessions.appliedCouponId,
      discountCents: checkoutSessions.discountCents,
      subtotalAmount: checkoutSessions.subtotalAmount,
      btcReceiveAddress: checkoutSessions.btcReceiveAddress,
      couponDuration: coupons.duration,
      couponDurationInCycles: coupons.durationInCycles,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .leftJoin(coupons, eq(coupons.id, checkoutSessions.appliedCouponId))
    .where(eq(checkoutSessions.id, sessionId));

  if (!session) {
    return (
      <CheckoutStateCard
        icon={
          <XCircle size={40} strokeWidth={1.5} className="text-destructive" />
        }
        title="Checkout not found"
        description="This checkout session does not exist or has been removed."
      />
    );
  }

  const deployment = resolveDeploymentForMode(session.livemode);

  if (session.status === "completed") {
    return (
      <CheckoutStateCard
        icon={
          <CheckCircle2 size={40} strokeWidth={1.5} className="text-success" />
        }
        title="This checkout has already been paid"
        description="This payment link has already been used. If you need a receipt, contact the merchant or check your email for the invoice."
      />
    );
  }

  const isExpired =
    session.status === "expired" ||
    (session.status === "active" && new Date(session.expiresAt) < new Date());

  if (isExpired) {
    return (
      <CheckoutStateCard
        icon={<Clock size={40} strokeWidth={1.5} className="text-warning" />}
        title="This checkout has expired"
        description="This payment session is no longer active. Please request a new checkout link."
      />
    );
  }

  // Server-side gate so the BIP32 receive address never reaches the browser
  // for a session that cannot settle. The client branch in checkout-client
  // repeats this check as defence in depth.
  if (!UTXO_PAYMENTS_ENABLED && isUtxoNetwork(session.networkKey)) {
    return (
      <CheckoutStateCard
        icon={<Ban size={40} strokeWidth={1.5} className="text-warning" />}
        title={`${session.networkKey?.startsWith("bitcoin") ? "Bitcoin" : "Litecoin"} payments are temporarily unavailable`}
        description={UTXO_BUYER_NOTICE}
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

  const isSolanaSession =
    session.networkKey === "solana" || session.networkKey === "solana-devnet";

  const solanaConfig = isSolanaSession
    ? {
        paymentVaultProgramId:
          process.env.SOLANA_PAYMENT_VAULT_PROGRAM_ID ??
          process.env.NEXT_PUBLIC_SOLANA_PAYMENT_VAULT_PROGRAM_ID ??
          "",
        subscriptionManagerProgramId:
          process.env.SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID ??
          process.env.NEXT_PUBLIC_SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID ??
          "",
        platformWallet:
          process.env.SOLANA_PLATFORM_WALLET ??
          process.env.NEXT_PUBLIC_SOLANA_PLATFORM_WALLET ??
          "",
        // USDC SPL mint. Mainnet = Circle's canonical, devnet = the test
        // mint Circle publishes for devnet faucet usage.
        usdcMint:
          session.networkKey === "solana"
            ? process.env.NEXT_PUBLIC_SOLANA_USDC_MINT ??
              "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            : process.env.NEXT_PUBLIC_SOLANA_DEVNET_USDC_MINT ??
              "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      }
    : null;

  const clientTree = (
    <CheckoutClient
      session={session}
      availablePrices={availablePrices}
      chainId={deployment.chainId}
      paymentVaultAddress={deployment.paymentVault}
      subscriptionManagerAddress={deployment.subscriptionManager}
      usdcAddress={deployment.usdcAddress}
      solanaConfig={solanaConfig}
    />
  );

  // Only mount the Solana wallet-adapter tree for Solana sessions — keeps it
  // out of the bundle for every EVM checkout and avoids two wallet-discovery
  // stacks colliding at runtime.
  if (isSolanaSession) {
    return (
      <CheckoutProviders>
        <SolanaProviders cluster={session.networkKey === "solana" ? "mainnet-beta" : "devnet"}>
          {clientTree}
        </SolanaProviders>
      </CheckoutProviders>
    );
  }

  return <CheckoutProviders>{clientTree}</CheckoutProviders>;
}
