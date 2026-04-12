import { and, count, eq, gte, lte, sum, sql } from "drizzle-orm";
import { payments, subscriptions, merchantProfiles, merchantPayoutWallets } from "@paylix/db/schema";
import { db } from "@/lib/db";
import { getActiveOrgOrRedirect } from "@/lib/require-active-org";
import { FinishSetupBanner } from "@/components/finish-setup-banner";
import OverviewView from "./overview-view";

export default async function OverviewPage() {
  const { organizationId } = await getActiveOrgOrRedirect();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [
    totalRevenueResult,
    revenue30dResult,
    paymentCountResult,
    activeSubsResult,
    activeTrialsResult,
    convertingSoonResult,
    recentPayments,
    [profile],
    [wallet],
    revenueByDayRaw,
    subsGrowthRaw,
    subsBeforeWindowResult,
    totalCompletedTrialsResult,
    totalConvertedTrialsResult,
    cancelledLast30dResult,
    pastDueResult,
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
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "trialing"),
        ),
      ),
    db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "trialing"),
          lte(subscriptions.trialEndsAt, sevenDaysFromNow),
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
    db
      .select({
        date: sql<string>`to_char(${payments.createdAt}, 'YYYY-MM-DD')`,
        total: sql<number>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.organizationId, organizationId),
          eq(payments.status, "confirmed"),
          gte(payments.createdAt, thirtyDaysAgo),
        ),
      )
      .groupBy(sql`to_char(${payments.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${payments.createdAt}, 'YYYY-MM-DD')`),
    db
      .select({
        date: sql<string>`to_char(${subscriptions.createdAt}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)`,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          gte(subscriptions.createdAt, thirtyDaysAgo),
        ),
      )
      .groupBy(sql`to_char(${subscriptions.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${subscriptions.createdAt}, 'YYYY-MM-DD')`),
    db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "active"),
          sql`${subscriptions.createdAt} < ${thirtyDaysAgo}`,
        ),
      ),
    // Trial conversion rate: total completed trials
    db
      .select({ total: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          sql`${subscriptions.trialEndsAt} IS NOT NULL`,
          sql`${subscriptions.status} IN ('active', 'cancelled', 'expired')`,
        ),
      ),
    // Trial conversion rate: converted to active
    db
      .select({ total: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          sql`${subscriptions.trialEndsAt} IS NOT NULL`,
          eq(subscriptions.status, "active"),
        ),
      ),
    // Churn rate (30d): cancelled in last 30 days
    db
      .select({ total: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "cancelled"),
          gte(subscriptions.updatedAt, thirtyDaysAgo),
        ),
      ),
    // Past-due count
    db
      .select({ total: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "past_due"),
        ),
      ),
  ]);

  const totalRevenue = Number(totalRevenueResult[0]?.total ?? 0);
  const revenue30d = Number(revenue30dResult[0]?.total ?? 0);
  const paymentCount = paymentCountResult[0]?.count ?? 0;
  const activeSubs = activeSubsResult[0]?.count ?? 0;
  const activeTrials = activeTrialsResult[0]?.count ?? 0;
  const convertingSoon = convertingSoonResult[0]?.count ?? 0;

  // Health metrics
  const totalCompletedTrials = totalCompletedTrialsResult[0]?.total ?? 0;
  const totalConvertedTrials = totalConvertedTrialsResult[0]?.total ?? 0;
  const trialConversionRate = totalCompletedTrials > 0
    ? Math.round((totalConvertedTrials / totalCompletedTrials) * 100)
    : null;

  const cancelledLast30d = cancelledLast30dResult[0]?.total ?? 0;
  const churnRate = activeSubs > 0
    ? Math.round((cancelledLast30d / (activeSubs + cancelledLast30d)) * 100)
    : null;

  const pastDueCount = pastDueResult[0]?.total ?? 0;

  const revenueByDay = fillDateRange(revenueByDayRaw, "total");
  const subsBeforeWindow = subsBeforeWindowResult[0]?.count ?? 0;
  const subsGrowth = buildCumulativeSubs(subsGrowthRaw, subsBeforeWindow);

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
        activeTrials={activeTrials}
        convertingSoon={convertingSoon}
        trialConversionRate={trialConversionRate}
        churnRate={churnRate}
        pastDueCount={pastDueCount}
        recentPayments={recentPayments}
        revenueByDay={revenueByDay}
        subsGrowth={subsGrowth}
      />
    </>
  );
}

function fillDateRange(
  data: Array<{ date: string; total: number }>,
  valueKey: string,
  days = 30,
) {
  const map = new Map(
    data.map((d) => [d.date, Number(d[valueKey as keyof typeof d] ?? 0) / 100]),
  );
  const result: Array<{ date: string; total: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, total: map.get(key) ?? 0 });
  }
  return result;
}

function buildCumulativeSubs(
  data: Array<{ date: string; count: number }>,
  startingCount: number,
) {
  const map = new Map(data.map((d) => [d.date, Number(d.count)]));
  const result: Array<{ date: string; cumulative: number }> = [];
  let cumulative = startingCount;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    cumulative += map.get(key) ?? 0;
    result.push({ date: key, cumulative });
  }
  return result;
}
