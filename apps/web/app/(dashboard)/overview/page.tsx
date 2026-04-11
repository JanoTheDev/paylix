import { and, count, eq, gte, sum, sql } from "drizzle-orm";
import { payments, subscriptions, merchantProfiles, merchantPayoutWallets } from "@paylix/db/schema";
import { db } from "@/lib/db";
import { getActiveOrgOrRedirect } from "@/lib/require-active-org";
import { FinishSetupBanner } from "@/components/finish-setup-banner";
import OverviewView from "./overview-view";

export default async function OverviewPage() {
  const { organizationId } = await getActiveOrgOrRedirect();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    totalRevenueResult,
    revenue30dResult,
    paymentCountResult,
    activeSubsResult,
    recentPayments,
    [profile],
    [wallet],
  ] = await Promise.all([
    db
      .select({ total: sum(payments.amount) })
      .from(payments)
      .where(
        and(eq(payments.organizationId, organizationId), eq(payments.status, "confirmed")),
      ),
    db
      .select({ total: sum(payments.amount) })
      .from(payments)
      .where(
        and(
          eq(payments.organizationId, organizationId),
          eq(payments.status, "confirmed"),
          gte(payments.createdAt, thirtyDaysAgo),
        ),
      ),
    db
      .select({ count: count() })
      .from(payments)
      .where(eq(payments.organizationId, organizationId)),
    db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "active"),
        ),
      ),
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        status: payments.status,
        txHash: payments.txHash,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.organizationId, organizationId))
      .orderBy(sql`${payments.createdAt} desc`)
      .limit(10),
    db
      .select()
      .from(merchantProfiles)
      .where(eq(merchantProfiles.organizationId, organizationId)),
    db
      .select()
      .from(merchantPayoutWallets)
      .where(eq(merchantPayoutWallets.organizationId, organizationId)),
  ]);

  const totalRevenue = Number(totalRevenueResult[0]?.total ?? 0);
  const revenue30d = Number(revenue30dResult[0]?.total ?? 0);
  const paymentCount = paymentCountResult[0]?.count ?? 0;
  const activeSubs = activeSubsResult[0]?.count ?? 0;

  const needsProfile = !profile || !profile.legalName;
  const needsWallet = !wallet;

  return (
    <>
      {(needsProfile || needsWallet) && (
        <FinishSetupBanner
          nextHref={needsProfile ? "/onboarding/profile" : "/onboarding/wallet"}
          nextLabel={
            needsProfile
              ? "Add your company profile to enable invoicing."
              : "Add a payout wallet to receive USDC."
          }
        />
      )}
      <OverviewView
        totalRevenue={totalRevenue}
        revenue30d={revenue30d}
        paymentCount={paymentCount}
        activeSubs={activeSubs}
        recentPayments={recentPayments}
      />
    </>
  );
}
