import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { paymentLinks } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { clientIp } from "../../_shared/client-ip";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const { id } = await params;
  const [row] = await db
    .select()
    .from(paymentLinks)
    .where(
      and(eq(paymentLinks.id, id), orgScope(paymentLinks, { organizationId, livemode })),
    )
    .limit(1);
  if (!row) return apiError("not_found", "Not found", 404);
  return NextResponse.json(row);
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string()).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "validation_failed",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const patch: Partial<{
    name: string;
    maxRedemptions: number | null;
    isActive: boolean;
    metadata: Record<string, string>;
  }> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.maxRedemptions !== undefined) {
    patch.maxRedemptions = parsed.data.maxRedemptions;
  }
  if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;
  if (parsed.data.metadata !== undefined) patch.metadata = parsed.data.metadata;

  if (Object.keys(patch).length === 0) {
    return apiError("invalid_request", "No valid fields to update");
  }

  const [updated] = await db
    .update(paymentLinks)
    .set(patch)
    .where(
      and(eq(paymentLinks.id, id), orgScope(paymentLinks, { organizationId, livemode })),
    )
    .returning();
  if (!updated) return apiError("not_found", "Not found", 404);

  void recordAudit({
    organizationId,
    userId,
    action: "payment_link.updated",
    resourceType: "payment_link",
    resourceId: id,
    details: patch as Record<string, unknown>,
    ipAddress: clientIp(request),
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;

  const [updated] = await db
    .update(paymentLinks)
    .set({ isActive: false })
    .where(
      and(eq(paymentLinks.id, id), orgScope(paymentLinks, { organizationId, livemode })),
    )
    .returning();
  if (!updated) return apiError("not_found", "Not found", 404);

  void recordAudit({
    organizationId,
    userId,
    action: "payment_link.archived",
    resourceType: "payment_link",
    resourceId: id,
    ipAddress: clientIp(request),
  });

  return NextResponse.json({ success: true });
}
