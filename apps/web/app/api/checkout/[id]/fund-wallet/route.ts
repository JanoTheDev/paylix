import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkoutSessions, faucetMints } from "@paylix/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { mintMockUsdc } from "@/lib/faucet";
import {
  checkFaucetLimits,
  FAUCET_WINDOW_MS,
  PER_WALLET_DAILY_LIMIT_WEI,
} from "@/lib/faucet-limits";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [session] = await db
    .select({
      id: checkoutSessions.id,
      livemode: checkoutSessions.livemode,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", "Request body must be valid JSON", 400);
  }

  const parsed = body as { address?: unknown };
  const address = typeof parsed.address === "string" ? parsed.address : null;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return apiError("invalid_address", "address must be a valid Ethereum address", 400);
  }

  const amountWei = PER_WALLET_DAILY_LIMIT_WEI;

  const deployment = resolveDeploymentForMode(false);
  const cutoff = new Date(Date.now() - FAUCET_WINDOW_MS);

  const walletTotalRow = await db
    .select({ total: sql<string>`coalesce(sum(${faucetMints.amount}), 0)` })
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
    walletMintedInWindow: BigInt(walletTotalRow[0]?.total ?? "0"),
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
    organizationId: null,
    checkoutSessionId: session.id,
    livemode: false,
  });

  return NextResponse.json({
    success: true,
    txHash: mint.txHash,
    amountMinted: 1000,
  });
}
