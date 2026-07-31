import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { faucetMints } from "@paylix/db/schema";
import { and, eq, gt, sql, count } from "drizzle-orm";
import { authenticateApiKey } from "@/lib/api-auth";
import { apiError } from "@/lib/api-error";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { mintMockUsdc } from "@/lib/faucet";
import { checkFaucetLimits, FAUCET_WINDOW_MS } from "@/lib/faucet-limits";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { clientIpKey } from "../../_shared/client-ip";
import { readJsonBody, parseWith } from "../../_shared/http";
import { baseUnitsPerCentFor } from "../../_shared/token-scale";
import { z } from "zod";

const faucetSchema = z.object({
  address: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, "address must be a valid Ethereum address"),
  amount: z.number().int().min(1).max(100_000).optional(),
});

export async function POST(request: Request) {
  // Secret keys only. `undefined` here accepted `pk_test_` keys, which are
  // by definition embeddable in client-side code — any visitor to a
  // merchant's checkout page could extract one and drain the org's faucet
  // allocation. Every other key-authenticated route passes "secret".
  const auth = await authenticateApiKey(request, "secret", {
    key: "faucet",
    perMinute: 10,
  });
  if (auth?.rateLimitResponse) return auth.rateLimitResponse;
  if (!auth) return apiError("unauthorized", "Invalid or missing API key", 401);

  // Per-IP limit on top of the per-key one, so a leaked key can't be
  // fanned out across machines to exhaust the global window cap.
  const ipLimit = await checkRateLimitAsync(`faucet-ip:${clientIpKey(request)}`, 10, 60_000);
  if (!ipLimit.ok) {
    return apiError(
      "rate_limited",
      `Too many faucet requests. Retry in ${Math.ceil((ipLimit.retryAfterMs ?? 0) / 1000)}s`,
      429,
    );
  }

  if (auth.livemode) {
    return apiError(
      "live_mode_not_supported",
      "The faucet is only available in test mode. Use a pk_test_ or sk_test_ key.",
      400,
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseWith(faucetSchema, body.data);
  if (!parsed.ok) return parsed.response;

  const address = parsed.data.address;
  const amount = parsed.data.amount ?? 1000;

  const deployment = resolveDeploymentForMode(false);

  // `amount` is whole USDC. Derive the scale from the registry rather than
  // hardcoding `* 1_000_000n` (6 decimals) — the same assumption API-13
  // removed from the tax, analytics and refund paths.
  const unitsPerCent = baseUnitsPerCentFor(deployment.networkKey, "USDC");
  if (unitsPerCent === null) {
    return apiError(
      "unsupported_token",
      `USDC is not registered on ${deployment.networkKey}; cannot size a faucet mint.`,
      409,
    );
  }
  const amountWei = BigInt(amount) * 100n * unitsPerCent;
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
