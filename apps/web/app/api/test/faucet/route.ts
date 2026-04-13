import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { faucetMints } from "@paylix/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { authenticateApiKey } from "@/lib/api-auth";
import { apiError } from "@/lib/api-error";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { mintMockUsdc } from "@/lib/faucet";
import { checkFaucetLimits, FAUCET_WINDOW_MS } from "@/lib/faucet-limits";

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (auth?.rateLimitResponse) return auth.rateLimitResponse;
  if (!auth) return apiError("unauthorized", "Invalid or missing API key", 401);

  if (auth.livemode) {
    return apiError(
      "live_mode_not_supported",
      "The faucet is only available in test mode. Use a pk_test_ or sk_test_ key.",
      400,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", "Request body must be valid JSON", 400);
  }

  const parsed = body as { address?: unknown; amount?: unknown };
  const address = typeof parsed.address === "string" ? parsed.address : null;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return apiError("invalid_address", "address must be a valid Ethereum address", 400);
  }

  const amount =
    typeof parsed.amount === "number" && parsed.amount > 0
      ? Math.floor(parsed.amount)
      : 1000;
  const amountWei = BigInt(amount) * 1_000_000n;

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
    source: "sdk",
    organizationId: auth.organizationId,
    checkoutSessionId: null,
    livemode: false,
  });

  return NextResponse.json({
    success: true,
    txHash: mint.txHash,
    amountMinted: amount,
  });
}
