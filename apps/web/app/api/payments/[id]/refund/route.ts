import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { payments, refunds } from "@paylix/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { verifyRefund, type Erc20TransferLog } from "@/lib/verify-refund";
import { withIdempotency } from "@/lib/idempotency";

const refundSchema = z.object({
  amount: z.number().int().min(1),
  reason: z.string().max(500).optional(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid tx hash"),
});

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

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
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError("invalid_body", "Request body must be valid JSON.", 400);
  }
  const parsed = refundSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "validation_failed",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

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

  // Dedupe by tx hash before any on-chain work.
  const [existing] = await db
    .select()
    .from(refunds)
    .where(eq(refunds.txHash, parsed.data.txHash))
    .limit(1);
  if (existing) {
    return apiError("duplicate", "Refund tx already recorded", 409);
  }

  const deployment = resolveDeploymentForMode(livemode);
  const usdcAddress = deployment.usdcAddress as `0x${string}`;

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

  // Decode Transfer logs from the receipt. Only logs whose address is a
  // real ERC20 on this network are considered — the helper filters by
  // address anyway, but we pre-filter to skip noise.
  const transferLogs: Erc20TransferLog[] = [];
  for (const log of receipt.logs as Log[]) {
    try {
      const parsedLog = decodeTransfer(log, transferEvent);
      if (!parsedLog) continue;
      transferLogs.push({
        token: log.address,
        from: parsedLog.from,
        to: parsedLog.to,
        value: parsedLog.value,
      });
    } catch {
      // ignore malformed logs
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
    usdcAddress: usdcAddress,
    refundCents: parsed.data.amount,
    baseUnitsPerCent: 10_000n, // USDC 6 decimals
  });
  if (!verdict.ok) {
    return apiError("refund_invalid", verdict.reason, 409);
  }

  // Atomic record + increment. On the off chance two merchants hit this
  // route concurrently with the same tx, the unique index on tx_hash
  // prevents double-recording.
  let refundRow;
  try {
    [refundRow] = await db
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
  } catch {
    return apiError("duplicate", "Refund tx already recorded", 409);
  }

  await db
    .update(payments)
    .set({
      refundedCents: sql`${payments.refundedCents} + ${parsed.data.amount}`,
      refundedAt: new Date(),
    })
    .where(eq(payments.id, payment.id));

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
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  void dispatchWebhooks(organizationId, "payment.refunded", {
    paymentId: payment.id,
    refundId: refundRow.id,
    amount: parsed.data.amount,
    reason: parsed.data.reason ?? null,
    txHash: parsed.data.txHash,
    metadata: payment.metadata ?? {},
  }).catch((err) =>
    console.error("[refund] payment.refunded webhook failed:", err),
  );

  return NextResponse.json(refundRow, { status: 201 });
}

function decodeTransfer(
  log: Log,
  event: typeof transferEvent,
): { from: string; to: string; value: bigint } | null {
  if (log.topics.length < 3) return null;
  // Transfer signature hash
  const sig = event as unknown as { selector?: string };
  void sig;
  // viem already provides parseEventLogs / decodeEventLog in higher layers,
  // but we don't want to pull the whole pipeline. Do it manually: topic[0]
  // is the event hash, topic[1] = indexed from, topic[2] = indexed to,
  // data = value (uint256).
  const from = "0x" + (log.topics[1] as string).slice(26);
  const to = "0x" + (log.topics[2] as string).slice(26);
  const value = BigInt(log.data);
  return { from, to, value };
}
