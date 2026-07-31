import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { refundRequests } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";
import { clientIp } from "../../../_shared/client-ip";
import { readJsonBody, parseWith } from "../../../_shared/http";
import { requireRole } from "../../../_shared/roles";

const schema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  // Deciding a customer's refund request is a money decision.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const { id } = await params;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseWith(schema, body.data ?? {});
  if (!parsed.ok) return parsed.response;

  const [updated] = await db
    .update(refundRequests)
    .set({
      status: "declined",
      merchantReason: parsed.data.reason ?? null,
      decidedBy: userId,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(refundRequests.id, id),
        eq(refundRequests.status, "pending"),
        orgScope(refundRequests, { organizationId, livemode }),
      ),
    )
    .returning();
  if (!updated) {
    return apiError("not_found", "Pending request not found", 404);
  }

  void recordAudit({
    organizationId,
    userId,
    action: "refund_request.declined",
    resourceType: "refund_request",
    resourceId: id,
    details: { reason: parsed.data.reason ?? null },
    ipAddress: clientIp(request),
  });

  void dispatchWebhooks(organizationId, "refund.declined", {
    refundRequestId: updated.id,
    paymentId: updated.paymentId,
    customerId: updated.customerId,
    amount: updated.amount,
    merchantReason: updated.merchantReason,
  }, livemode).catch((err) =>
    console.error("[refund-request decline] webhook failed:", err),
  );

  return NextResponse.json(updated);
}
