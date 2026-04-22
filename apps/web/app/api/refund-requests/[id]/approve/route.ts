import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  refundRequests,
  refunds,
  payments,
} from "@paylix/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createPublicClient, http, type Log } from "viem";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { verifyRefund, type Erc20TransferLog } from "@/lib/verify-refund";

const schema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid tx hash"),
});

/**
 * Merchant approve. Mirrors the refund flow — takes the tx hash of the
 * merchant->buyer transfer, verifies it on-chain, records the refund,
 * flips the request to approved with refund_id linked.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "validation_failed",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const [req] = await db
    .select()
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.id, id),
        eq(refundRequests.status, "pending"),
        orgScope(refundRequests, { organizationId, livemode }),
      ),
    )
    .limit(1);
  if (!req) return apiError("not_found", "Pending request not found", 404);

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, req.paymentId))
    .limit(1);
  if (!payment?.fromAddress || !payment?.toAddress) {
    return apiError("payment_missing_addresses", "Payment lacks addresses", 409);
  }

  const deployment = resolveDeploymentForMode(livemode);
  const usdcAddress = deployment.usdcAddress as `0x${string}`;
  const publicClient = createPublicClient({
    chain: deployment.chain,
    transport: http(deployment.rpcUrl),
  });

  let receipt;
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

  const transferLogs: Erc20TransferLog[] = [];
  for (const log of receipt.logs as Log[]) {
    if (log.topics.length < 3) continue;
    try {
      const from = ("0x" + (log.topics[1] as string).slice(26)) as string;
      const to = ("0x" + (log.topics[2] as string).slice(26)) as string;
      const value = BigInt(log.data);
      transferLogs.push({ token: log.address, from, to, value });
    } catch {
      // malformed — skip
    }
  }

  const verdict = verifyRefund({
    transferLogs,
    payment: {
      fromAddress: payment.fromAddress,
      toAddress: payment.toAddress,
      refundedCents: payment.refundedCents,
      amountCents: payment.amount,
    },
    usdcAddress,
    refundCents: req.amount,
    baseUnitsPerCent: 10_000n,
  });
  if (!verdict.ok) {
    return apiError("refund_invalid", verdict.reason, 409);
  }

  // Transactional: insert refund row, bump payments.refunded_cents,
  // flip request. Unique index on refunds.tx_hash guards duplicates.
  const refundRow = await db.transaction(async (tx) => {
    try {
      const [r] = await tx
        .insert(refunds)
        .values({
          paymentId: payment.id,
          organizationId,
          amount: req.amount,
          reason: req.reason ?? "Customer refund request",
          txHash: parsed.data.txHash,
          status: "confirmed",
          createdBy: userId,
          livemode,
        })
        .returning();
      await tx
        .update(payments)
        .set({
          refundedCents: sql`${payments.refundedCents} + ${req.amount}`,
          refundedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));
      await tx
        .update(refundRequests)
        .set({
          status: "approved",
          decidedBy: userId,
          decidedAt: new Date(),
          refundId: r.id,
        })
        .where(eq(refundRequests.id, id));
      return r;
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
    action: "refund_request.approved",
    resourceType: "refund_request",
    resourceId: id,
    details: { refundId: refundRow.id, amount: req.amount },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  void dispatchWebhooks(organizationId, "refund.approved", {
    refundRequestId: id,
    refundId: refundRow.id,
    paymentId: payment.id,
    customerId: req.customerId,
    amount: req.amount,
    txHash: parsed.data.txHash,
  }).catch((err) => console.error("[refund-request approve] webhook failed:", err));

  void dispatchWebhooks(organizationId, "payment.refunded", {
    paymentId: payment.id,
    refundId: refundRow.id,
    amount: req.amount,
    reason: req.reason ?? null,
    txHash: parsed.data.txHash,
    metadata: payment.metadata ?? {},
  }).catch((err) => console.error("[refund-request approve] payment.refunded webhook failed:", err));

  return NextResponse.json({ success: true, refundId: refundRow.id });
}
