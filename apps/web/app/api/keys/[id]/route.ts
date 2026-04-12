import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { apiKeys } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId } = ctx;

  const { id } = await params;

  const [updated] = await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, organizationId)))
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
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ success: true });
}
