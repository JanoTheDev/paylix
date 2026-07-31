import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { payments, refunds } from "@paylix/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createPublicClient, http } from "viem";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { verifyRefund } from "@/lib/verify-refund";
import { withIdempotency } from "@/lib/idempotency";
import {
  getToken,
  resolveTokenAddress,
  type NetworkKey,
} from "@paylix/config/networks";
import { clientIp } from "../../../_shared/client-ip";
import { decodeTransferLogs } from "../../../_shared/transfer-logs";
import { parseJsonBody, parseWith } from "../../../_shared/http";
import { requireRole } from "../../../_shared/roles";
import { baseUnitsPerCentFor } from "../../../_shared/token-scale";

const refundSchema = z.object({
  amount: z.number().int().min(1),
  reason: z.string().max(500).optional(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid tx hash"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  // Recording a refund moves money out of the merchant's wallet and
  // permanently marks the payment. Members can't do it.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const { id } = await params;

  return withIdempotency(request, organizationId, async (rawBody) => {
    return handleRefund(rawBody, { id, organizationId, userId, livemode, request });
  });
}

async function handleRefund(
  rawBody: string,
  args: {
    id: string;
    organizationId: string;
    userId: string;
    livemode: boolean;
    request: Request;
  },
): Promise<Response> {
  const { id, organizationId, userId, livemode, request } = args;
  const body = parseJsonBody(rawBody);
  if (!body.ok) return body.response;
  const parsed = parseWith(refundSchema, body.data);
  if (!parsed.ok) return parsed.response;

  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), orgScope(payments, { organizationId, livemode })))
    .limit(1);
  if (!payment) return apiError("not_found", "Payment not found", 404);
  if (payment.status !== "confirmed") {
    return apiError(
      "invalid_status",
      "Only confirmed payments can be refunded",
      409,
    );
  }
  if (!payment.fromAddress || !payment.toAddress) {
    return apiError(
      "missing_addresses",
      "Payment is missing buyer/merchant addresses",
      409,
    );
  }

  // Dedupe by tx hash before any on-chain work. Org-scoped: without the
  // scope, another org's recorded hash returned 409 here, which is a
  // cross-tenant existence oracle and also blocked legitimate refunds that
  // happened to collide. The unique index on tx_hash stays as the hard guard.
  const [existing] = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.txHash, parsed.data.txHash),
        orgScope(refunds, { organizationId, livemode }),
      ),
    )
    .limit(1);
  if (existing) {
    return apiError("duplicate", "Refund tx already recorded", 409);
  }

  const deployment = resolveDeploymentForMode(livemode);

  // The cents↔base-unit scale is per-token, not a hardcoded 10_000. A
  // non-USDC refund used to be validated against the USDC magnitude, which
  // is off by 10^12 for an 18-decimal token.
  const baseUnitsPerCent = baseUnitsPerCentFor(payment.chain, payment.token);
  if (baseUnitsPerCent === null) {
    return apiError(
      "unsupported_token",
      `Token ${payment.token} on ${payment.chain} is not registered; cannot verify a refund against it.`,
      409,
    );
  }

  let tokenAddress = deployment.usdcAddress as `0x${string}`;
  if (payment.token !== "USDC") {
    try {
      tokenAddress = resolveTokenAddress(
        getToken(payment.chain as NetworkKey, payment.token),
      );
    } catch {
      return apiError(
        "unsupported_token",
        `Token ${payment.token} on ${payment.chain} has no resolvable address.`,
        409,
      );
    }
  }

  const publicClient = createPublicClient({
    chain: deployment.chain,
    transport: http(deployment.rpcUrl),
  });

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: parsed.data.txHash as `0x${string}`,
    });
  } catch {
    return apiError("tx_not_found", "Transaction not found on-chain", 409);
  }
  if (receipt.status !== "success") {
    return apiError("tx_reverted", "Transaction did not succeed", 409);
  }

  // Decode Transfer logs. `decodeTransferLogs` matches on the event
  // signature hash, so USDC's `Approval` — also a 3-topic event on the same
  // contract — no longer passes as a transfer.
  const transferLogs = decodeTransferLogs(receipt.logs);

  const verdict = verifyRefund({
    transferLogs,
    payment: {
      fromAddress: payment.fromAddress,
      toAddress: payment.toAddress,
      refundedCents: payment.refundedCents,
      amountCents: payment.amount,
    },
    usdcAddress: tokenAddress,
    refundCents: parsed.data.amount,
    baseUnitsPerCent,
  });
  if (!verdict.ok) {
    return apiError("refund_invalid", verdict.reason, 409);
  }

  // Atomic record + increment, in one transaction. Split across two
  // statements, a crash between them left the refund recorded but
  // `payments.refunded_cents` at 0 — so verifyRefund's over-refund guard
  // passed again and a second full refund could be recorded. The unique
  // index on tx_hash is the concurrency guard.
  const refundRow = await db.transaction(async (tx) => {
    try {
      const [row] = await tx
        .insert(refunds)
        .values({
          paymentId: payment.id,
          organizationId,
          amount: parsed.data.amount,
          reason: parsed.data.reason ?? null,
          txHash: parsed.data.txHash,
          status: "confirmed",
          createdBy: userId,
          livemode,
        })
        .returning();
      await tx
        .update(payments)
        .set({
          refundedCents: sql`${payments.refundedCents} + ${parsed.data.amount}`,
          refundedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));
      return row;
    } catch {
      return null;
    }
  });
  if (!refundRow) {
    return apiError("duplicate", "Refund tx already recorded", 409);
  }

  void recordAudit({
    organizationId,
    userId,
    action: "payment.refunded",
    resourceType: "payment",
    resourceId: payment.id,
    details: {
      refundId: refundRow.id,
      amount: parsed.data.amount,
      txHash: parsed.data.txHash,
    },
    ipAddress: clientIp(request),
  });

  void dispatchWebhooks(organizationId, "payment.refunded", {
    paymentId: payment.id,
    refundId: refundRow.id,
    amount: parsed.data.amount,
    reason: parsed.data.reason ?? null,
    txHash: parsed.data.txHash,
    metadata: payment.metadata ?? {},
  }, livemode).catch((err) =>
    console.error("[refund] payment.refunded webhook failed:", err),
  );

  return NextResponse.json(refundRow, { status: 201 });
}
