import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { blocklistEntries } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { clientIp } from "../../_shared/client-ip";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;

  const [deleted] = await db
    .delete(blocklistEntries)
    .where(
      and(
        eq(blocklistEntries.id, id),
        orgScope(blocklistEntries, { organizationId, livemode }),
      ),
    )
    .returning();
  if (!deleted) return apiError("not_found", "Not found", 404);

  void recordAudit({
    organizationId,
    userId,
    action: "blocklist.entry_removed",
    resourceType: "blocklist_entry",
    resourceId: id,
    details: { type: deleted.type, value: deleted.value },
    ipAddress: clientIp(request),
  });

  return NextResponse.json({ success: true });
}
