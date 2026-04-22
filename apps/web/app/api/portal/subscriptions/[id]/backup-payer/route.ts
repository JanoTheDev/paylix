import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { subscriptions, customers } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { verifyPortalToken } from "@/lib/portal-tokens";
import { apiError } from "@/lib/api-error";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { createRelayerClient } from "@/lib/relayer";
import { SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";

const schema = z.object({
  customerId: z.string().uuid(),
  token: z.string(),
  backup: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  subscriberAuthSig: z.string().regex(/^0x[0-9a-fA-F]+$/),
  authDeadline: z.number().int().positive(),
  permitValue: z.string().regex(/^\d+$/),
  permitDeadline: z.number().int().positive(),
  v: z.number().int(),
  r: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  s: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

/**
 * Customer submits a backup payer authorization + EIP-2612 permit for
 * an alternate wallet. Relayer forwards to the on-chain
 * addSubscriptionBackupPayer call. Subsequent charges that fail on
 * the primary fall through to this backup automatically.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: subscriptionId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "validation_failed",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const p = parsed.data;
  if (!verifyPortalToken(p.token, p.customerId)) {
    return apiError("invalid_token", "Invalid or expired portal token", 401);
  }

  const [sub] = await db
    .select({
      id: subscriptions.id,
      customerId: subscriptions.customerId,
      status: subscriptions.status,
      onChainId: subscriptions.onChainId,
      contractAddress: subscriptions.contractAddress,
      livemode: subscriptions.livemode,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  if (!sub) return apiError("not_found", "Subscription not found", 404);

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, sub.customerId), eq(customers.id, p.customerId)))
    .limit(1);
  if (!customer) return apiError("forbidden", "Not your subscription", 403);

  if (!sub.onChainId) {
    return apiError(
      "not_onchain",
      "Subscription is not yet on-chain (still in trial)",
      409,
    );
  }
  if (sub.status !== "active" && sub.status !== "past_due") {
    return apiError("invalid_status", "Subscription not active", 409);
  }

  const deployment = resolveDeploymentForMode(sub.livemode);
  if (
    sub.contractAddress &&
    sub.contractAddress.toLowerCase() !==
      deployment.subscriptionManager.toLowerCase()
  ) {
    return apiError(
      "deployment_mismatch",
      "Subscription is on a different contract deployment",
      409,
    );
  }

  const relayer = createRelayerClient(deployment);
  try {
    const txHash = await relayer.writeContract({
      address: deployment.subscriptionManager,
      abi: SUBSCRIPTION_MANAGER_ABI,
      functionName: "addSubscriptionBackupPayer",
      args: [
        {
          subscriptionId: BigInt(sub.onChainId),
          backup: p.backup as `0x${string}`,
          authDeadline: BigInt(p.authDeadline),
          permitValue: BigInt(p.permitValue),
          permitDeadline: BigInt(p.permitDeadline),
          v: p.v,
          r: p.r as `0x${string}`,
          s: p.s as `0x${string}`,
        },
        p.subscriberAuthSig as `0x${string}`,
      ],
    });
    return NextResponse.json({ txHash });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Relay failed";
    return apiError("relay_failed", message.slice(0, 400), 502);
  }
}
