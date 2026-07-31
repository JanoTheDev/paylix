import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { payments, subscriptions, productPrices } from "@paylix/db/schema";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import {
  aggregateActiveSubsByDay,
  aggregateFailedRateByDay,
  aggregateMrrByDay,
  aggregateRevenueByDay,
  arpuCents,
} from "@/lib/analytics";
import {
  baseUnitsPerCentFor,
  nativeUnitsToCentsSaturating,
} from "../_shared/token-scale";

const VALID_RANGES = [7, 30, 90] as const;

// Hard ceiling on the in-memory subscription rollup. The query deliberately
// skips the date filter (a sub active today may have been created long ago),
// so a bound is the only thing standing between a large merchant and an
// unbounded scan on every dashboard render.
const MAX_SUBSCRIPTION_ROWS = 20_000;

export async function GET(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const url = new URL(request.url);
  const rangeParam = Number.parseInt(url.searchParams.get("range") ?? "30", 10);
  const rangeDays = (
    VALID_RANGES.find((r) => r === rangeParam) ?? 30
  ) as number;

  const now = new Date();
  const endUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const startUtc = new Date(endUtc);
  startUtc.setUTCDate(startUtc.getUTCDate() - (rangeDays - 1));

  const paymentRows = await db
    .select({
      amount: payments.amount,
      status: payments.status,
      customerId: payments.customerId,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(
      and(
        orgScope(payments, { organizationId, livemode }),
        gte(payments.createdAt, startUtc),
        lte(payments.createdAt, new Date(endUtc.getTime() + 24 * 60 * 60 * 1000 - 1)),
      ),
    );

  // MRR / active subs need ALL subs whose lifecycle overlaps the window —
  // active today includes subs created long ago. So we don't range-filter
  // on createdAt here. Org+livemode + non-trial statuses is enough.
  //
  // amountCents is derived from product_prices, joined on
  // (productId, networkKey, tokenSymbol). The scale is per-token: dividing
  // native units by a hardcoded 10_000 assumed USDC's 6 decimals and was
  // off by 10^12 for an 18-decimal token, which then dominated the MRR
  // series.
  //
  // Bounded so a merchant with a very long subscription history can't load
  // the whole table into memory on each dashboard render.
  const subRowsRaw = await db
    .select({
      status: subscriptions.status,
      intervalSeconds: subscriptions.intervalSeconds,
      priceAmount: productPrices.amount,
      networkKey: subscriptions.networkKey,
      tokenSymbol: subscriptions.tokenSymbol,
      createdAt: subscriptions.createdAt,
      updatedAt: subscriptions.updatedAt,
      subStatus: subscriptions.status,
    })
    .from(subscriptions)
    .leftJoin(
      productPrices,
      and(
        eq(productPrices.productId, subscriptions.productId),
        eq(productPrices.networkKey, subscriptions.networkKey),
        eq(productPrices.tokenSymbol, subscriptions.tokenSymbol),
      ),
    )
    .where(
      and(
        orgScope(subscriptions, { organizationId, livemode }),
        inArray(subscriptions.status, [
          "active",
          "past_due",
          "paused",
          "cancelled",
          "trialing",
          "trial_conversion_failed",
        ]),
      ),
    )
    .limit(MAX_SUBSCRIPTION_ROWS);

  const subRows = subRowsRaw.map((r) => {
    const unitsPerCent = baseUnitsPerCentFor(r.networkKey, r.tokenSymbol);
    return {
      status: r.status,
      amountCents:
        r.priceAmount && unitsPerCent
          ? nativeUnitsToCentsSaturating(r.priceAmount, unitsPerCent)
          : 0,
      intervalSeconds: r.intervalSeconds,
      createdAt: r.createdAt,
      cancelledAt: r.subStatus === "cancelled" ? r.updatedAt : null,
    };
  });

  const revenueByDay = aggregateRevenueByDay(paymentRows, startUtc, endUtc);
  const failedRateByDay = aggregateFailedRateByDay(paymentRows, startUtc, endUtc);
  const mrrByDay = aggregateMrrByDay(subRows, startUtc, endUtc);
  const activeSubsByDay = aggregateActiveSubsByDay(subRows, startUtc, endUtc);
  const arpu = arpuCents(
    paymentRows.map((p) => ({
      amount: p.amount,
      status: p.status,
      customerId: p.customerId,
    })),
  );

  return NextResponse.json(
    {
      range: rangeDays,
      start: startUtc.toISOString(),
      end: endUtc.toISOString(),
      revenueByDay,
      mrrByDay,
      activeSubsByDay,
      failedRateByDay,
      arpuCents: arpu,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    },
  );
}
