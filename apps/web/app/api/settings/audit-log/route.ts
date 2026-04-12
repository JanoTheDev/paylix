import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, user } from "@paylix/db/schema";
import { resolveActiveOrg } from "@/lib/require-active-org";

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const logs = await db
    .select({
      id: auditLogs.id,
      userId: auditLogs.userId,
      userName: user.name,
      userEmail: user.email,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      details: auditLogs.details,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(user, eq(auditLogs.userId, user.id))
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);

  return NextResponse.json({
    logs: logs.map((l) => ({
      ...l,
      createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
    })),
  });
}
