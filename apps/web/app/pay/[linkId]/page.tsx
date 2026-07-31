import type { ReactNode } from "react";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Clock, Ban } from "lucide-react";
import { db } from "@/lib/db";
import {
  UTXO_BUYER_NOTICE,
  UTXO_PAYMENTS_ENABLED,
  isUtxoNetwork,
} from "@/app/_lib/utxo-payments";
import {
  paymentLinks,
  products,
  productPrices,
  checkoutSessions,
} from "@paylix/db/schema";
import { resolvePaymentLink } from "@/lib/payment-links";
import { resolvePayoutWallet } from "@/lib/payout-wallets";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { headers } from "next/headers";
import type { NetworkKey } from "@paylix/config/networks";

interface PayPageProps {
  params: Promise<{ linkId: string }>;
}

function ExpiredCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
      <div className="mb-3 flex justify-center">
        {icon ?? <Clock size={40} strokeWidth={1.5} className="text-warning" />}
      </div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-foreground-muted">{description}</p>
    </div>
  );
}

export default async function PayPage({ params }: PayPageProps) {
  const { linkId } = await params;

  // Public route: rate limit by caller IP to keep link resolution cheap.
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimitAsync(`pay:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return (
      <ExpiredCard
        title="Too many requests"
        description="Please wait a minute and try again."
      />
    );
  }

  const [link] = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.id, linkId))
    .limit(1);

  if (!link || !link.isActive) {
    return (
      <ExpiredCard
        title="Link expired"
        description="This payment link is no longer available."
      />
    );
  }

  const [product] = await db
    .select({
      id: products.id,
      type: products.type,
      isActive: products.isActive,
    })
    .from(products)
    .where(eq(products.id, link.productId))
    .limit(1);

  if (!product || !product.isActive) {
    return (
      <ExpiredCard
        title="Link expired"
        description="The linked product is no longer available."
      />
    );
  }

  // Gate BTC/LTC before the redemption counter is touched — a link the buyer
  // can't actually pay must not burn one of its redemptions. The UTXO
  // settlement path can't record a payment until `fiat_rate_cents` is
  // captured at quote time (see app/_lib/utxo-payments.ts).
  if (!UTXO_PAYMENTS_ENABLED && isUtxoNetwork(link.networkKey)) {
    return (
      <ExpiredCard
        icon={<Ban size={40} strokeWidth={1.5} className="text-warning" />}
        title="This payment method is unavailable"
        description={UTXO_BUYER_NOTICE}
      />
    );
  }

  // Pre-locked path: resolve merchant wallet + price amount.
  let lockedPrice:
    | {
        networkKey: string;
        tokenSymbol: string;
        amount: bigint;
        merchantWallet: `0x${string}`;
      }
    | null = null;
  if (link.networkKey && link.tokenSymbol) {
    const [price] = await db
      .select()
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, link.productId),
          eq(productPrices.networkKey, link.networkKey),
          eq(productPrices.tokenSymbol, link.tokenSymbol),
          eq(productPrices.isActive, true),
          eq(productPrices.livemode, link.livemode),
        ),
      )
      .limit(1);
    if (!price) {
      return (
        <ExpiredCard
          title="Link expired"
          description="The price for this link is no longer active."
        />
      );
    }
    let merchantWallet: `0x${string}`;
    try {
      merchantWallet = await resolvePayoutWallet(
        link.organizationId,
        link.networkKey as NetworkKey,
      );
    } catch {
      return (
        <ExpiredCard
          title="Link unavailable"
          description="The merchant has not configured a payout wallet for this network."
        />
      );
    }
    lockedPrice = {
      networkKey: link.networkKey,
      tokenSymbol: link.tokenSymbol,
      amount: price.amount,
      merchantWallet,
    };
  }

  // Atomic increment gated on max_redemptions. Two concurrent buyers can't
  // both push the count past the cap.
  const [incremented] = await db
    .update(paymentLinks)
    .set({ redemptionCount: sql`${paymentLinks.redemptionCount} + 1` })
    .where(
      and(
        eq(paymentLinks.id, link.id),
        eq(paymentLinks.isActive, true),
        link.maxRedemptions !== null
          ? sql`${paymentLinks.redemptionCount} < ${paymentLinks.maxRedemptions}`
          : sql`1=1`,
      ),
    )
    .returning({ id: paymentLinks.id });
  if (!incremented) {
    return (
      <ExpiredCard
        title="Link exhausted"
        description="This payment link has reached its redemption limit."
      />
    );
  }

  const resolution = resolvePaymentLink({
    link: {
      id: link.id,
      organizationId: link.organizationId,
      productId: link.productId,
      name: link.name,
      customerId: link.customerId,
      networkKey: link.networkKey,
      tokenSymbol: link.tokenSymbol,
      isActive: link.isActive,
      maxRedemptions: link.maxRedemptions,
      // Use pre-increment count; the atomic UPDATE already enforced the cap.
      redemptionCount: link.redemptionCount,
      metadata: link.metadata,
      livemode: link.livemode,
    },
    productType: product.type as "one_time" | "subscription",
    lockedPrice,
    now: new Date(),
    sessionTtlMs: 30 * 60 * 1000,
  });

  if (!resolution.ok) {
    return (
      <ExpiredCard
        title="Link expired"
        description="This payment link is no longer usable."
      />
    );
  }

  const [session] = await db
    .insert(checkoutSessions)
    .values(resolution.sessionValues)
    .returning({ id: checkoutSessions.id });

  redirect(`/checkout/${session.id}`);
}
