import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkoutSessions, faucetMints } from "@paylix/db/schema";
import { and, eq, gt, sql, count } from "drizzle-orm";
import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { mintMockUsdc } from "@/lib/faucet";
import {
  checkFaucetLimits,
  FAUCET_WINDOW_MS,
  PER_MINT_MAX_WEI,
} from "@/lib/faucet-limits";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { clientIpKey } from "../../../_shared/client-ip";
import { readJsonBody, parseWith } from "../../../_shared/http";

const fundSchema = z.object({
  address: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, "address must be a valid Ethereum address"),
});

/**
 * Test-mode faucet reachable from the checkout page.
 *
 * The only gate used to be "a test-mode session with this id exists", so
 * anyone holding any test session id could mint to arbitrary addresses until
 * the global window cap tripped — a denial of service against every other
 * tester. Now: an IP + session rate limit, and the mint is attributed to the
 * session's organization so per-org accounting works.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ip = clientIpKey(request);
  const ipLimit = await checkRateLimitAsync(`fund-wallet:${ip}`, 5, 60_000);
  if (!ipLimit.ok) {
    return apiError(
      "rate_limited",
      `Too many faucet requests. Retry in ${Math.ceil((ipLimit.retryAfterMs ?? 0) / 1000)}s`,
      429,
    );
  }
  const sessionLimit = await checkRateLimitAsync(
    `fund-wallet-session:${id}`,
    3,
    60_000,
  );
  if (!sessionLimit.ok) {
    return apiError(
      "rate_limited",
      `Too many faucet requests for this checkout. Retry in ${Math.ceil((sessionLimit.retryAfterMs ?? 0) / 1000)}s`,
      429,
    );
  }

  const [session] = await db
    .select({
      id: checkoutSessions.id,
      livemode: checkoutSessions.livemode,
      organizationId: checkoutSessions.organizationId,
    })
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, id))
    .limit(1);

  if (!session) {
    return apiError("not_found", "Checkout session not found", 404);
  }

  if (session.livemode) {
    return apiError(
      "live_mode_not_supported",
      "The faucet is only available for test-mode checkout sessions",
      400,
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseWith(fundSchema, body.data);
  if (!parsed.ok) return parsed.response;
  const address = parsed.data.address;

  const amountWei = PER_MINT_MAX_WEI;

  const deployment = resolveDeploymentForMode(false);
  const cutoff = new Date(Date.now() - FAUCET_WINDOW_MS);

  const walletCountRow = await db
    .select({ mints: count() })
    .from(faucetMints)
    .where(
      and(
        eq(faucetMints.walletAddress, address),
        gt(faucetMints.createdAt, cutoff),
      ),
    );
  const globalTotalRow = await db
    .select({ total: sql<string>`coalesce(sum(${faucetMints.amount}), 0)` })
    .from(faucetMints)
    .where(gt(faucetMints.createdAt, cutoff));

  const decision = checkFaucetLimits({
    walletAddress: address,
    requestedAmount: amountWei,
    walletMintsInWindow: Number(walletCountRow[0]?.mints ?? 0),
    globalMintedInWindow: BigInt(globalTotalRow[0]?.total ?? "0"),
    now: new Date(),
  });

  if (!decision.ok) {
    return apiError(decision.code, decision.reason, 429);
  }

  const mint = await mintMockUsdc(
    deployment,
    address as `0x${string}`,
    amountWei,
  );

  await db.insert(faucetMints).values({
    walletAddress: address,
    amount: amountWei,
    txHash: mint.txHash,
    chainId: deployment.chainId,
    source: "checkout",
    // Attribute the mint so per-org faucet accounting is possible; a null
    // here made every checkout-sourced mint unattributable.
    organizationId: session.organizationId,
    checkoutSessionId: session.id,
    livemode: false,
  });

  return NextResponse.json({
    success: true,
    txHash: mint.txHash,
    amountMinted: 1000,
  });
}
