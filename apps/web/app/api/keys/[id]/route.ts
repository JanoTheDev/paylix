import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { apiKeys } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { clientIp } from "../../_shared/client-ip";
import { requireRole } from "../../_shared/roles";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  // Revoking a key can take a merchant's integration offline.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const { id } = await params;

  const [updated] = await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(and(eq(apiKeys.id, id), orgScope(apiKeys, { organizationId, livemode })))
    .returning();

  if (!updated) {
    return apiError("not_found", "Not found", 404);
  }

  void recordAudit({
    organizationId,
    userId,
    action: "api_key.revoked",
    resourceType: "api_key",
    resourceId: id,
    ipAddress: clientIp(request),
  });

  return NextResponse.json({ success: true });
}
