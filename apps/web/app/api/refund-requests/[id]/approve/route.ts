import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  refundRequests,
  refunds,
  payments,
} from "@paylix/db/schema";
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
import {
  getToken,
  resolveTokenAddress,
  type NetworkKey,
} from "@paylix/config/networks";
import { clientIp } from "../../../_shared/client-ip";
import { decodeTransferLogs } from "../../../_shared/transfer-logs";
import { readJsonBody, parseWith } from "../../../_shared/http";
import { requireRole } from "../../../_shared/roles";
import { baseUnitsPerCentFor } from "../../../_shared/token-scale";

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

  // Approving a refund records money leaving the merchant's wallet.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const { id } = await params;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseWith(schema, body.data);
  if (!parsed.ok) return parsed.response;

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

  // Scope the payment lookup too — the refund request is org-scoped, but
  // reading its payment without a scope would still cross the tenant line
  // if a request row ever pointed elsewhere.
  const [payment] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.id, req.paymentId),
        orgScope(payments, { organizationId, livemode }),
      ),
    )
    .limit(1);
  if (!payment?.fromAddress || !payment?.toAddress) {
    return apiError("payment_missing_addresses", "Payment lacks addresses", 409);
  }

  const deployment = resolveDeploymentForMode(livemode);

  // Per-token cents scale — see the matching comment in payments/[id]/refund.
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

  // Signature-checked decode. The hand-rolled version here had no topic[0]
  // comparison at all, so any 3-topic log (notably USDC `Approval`) was read
  // as a transfer and satisfied verifyRefund without moving funds.
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
    refundCents: req.amount,
    baseUnitsPerCent,
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
    ipAddress: clientIp(request),
  });

  void dispatchWebhooks(organizationId, "refund.approved", {
    refundRequestId: id,
    refundId: refundRow.id,
    paymentId: payment.id,
    customerId: req.customerId,
    amount: req.amount,
    txHash: parsed.data.txHash,
  }, livemode).catch((err) => console.error("[refund-request approve] webhook failed:", err));

  void dispatchWebhooks(organizationId, "payment.refunded", {
    paymentId: payment.id,
    refundId: refundRow.id,
    amount: req.amount,
    reason: req.reason ?? null,
    txHash: parsed.data.txHash,
    metadata: payment.metadata ?? {},
  }, livemode).catch((err) => console.error("[refund-request approve] payment.refunded webhook failed:", err));

  return NextResponse.json({ success: true, refundId: refundRow.id });
}
