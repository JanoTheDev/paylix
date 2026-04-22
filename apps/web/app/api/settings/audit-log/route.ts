import { NextResponse } from "next/server";
import { and, desc, eq, gte, ilike, lte, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, user } from "@paylix/db/schema";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const url = new URL(request.url);
  const filters: SQL[] = [orgScope(auditLogs, { organizationId, livemode })];

  const action = url.searchParams.get("action");
  if (action) filters.push(eq(auditLogs.action, action));

  const resourceType = url.searchParams.get("resourceType");
  if (resourceType) filters.push(eq(auditLogs.resourceType, resourceType));

  const resourceId = url.searchParams.get("resourceId");
  if (resourceId) filters.push(eq(auditLogs.resourceId, resourceId));

  const userId = url.searchParams.get("userId");
  if (userId) filters.push(eq(auditLogs.userId, userId));

  const from = url.searchParams.get("from");
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) {
      filters.push(gte(auditLogs.createdAt, d));
    }
  }
  const to = url.searchParams.get("to");
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      filters.push(lte(auditLogs.createdAt, d));
    }
  }

  // Free-text search: matches resource_id prefix, user email, and
  // JSON-serialized details. Uses ilike; for large orgs a pg_trgm index
  // on details::text is recommended (migration pending).
  const q = url.searchParams.get("q");
  if (q) {
    const term = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const textMatch = or(
      ilike(auditLogs.resourceId, term),
      ilike(sql`${auditLogs.details}::text`, term),
      ilike(user.email, term),
      ilike(user.name, term),
    );
    if (textMatch) filters.push(textMatch);
  }

  // Cursor pagination: pass the createdAt of the last row as `before`.
  const before = url.searchParams.get("before");
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) {
      filters.push(lt(auditLogs.createdAt, d));
    }
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)),
  );

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
    .where(and(...filters))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  // Distinct action + resourceType values for the client dropdowns.
  // Cheap: auditLogs.action cardinality is low (single digits of distinct
  // values per org in practice).
  const [actions, resourceTypes] = await Promise.all([
    db
      .selectDistinct({ v: auditLogs.action })
      .from(auditLogs)
      .where(orgScope(auditLogs, { organizationId, livemode })),
    db
      .selectDistinct({ v: auditLogs.resourceType })
      .from(auditLogs)
      .where(orgScope(auditLogs, { organizationId, livemode })),
  ]);

  return NextResponse.json({
    logs: logs.map((l) => ({
      ...l,
      createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
    })),
    nextCursor:
      logs.length === limit ? logs[logs.length - 1].createdAt.toISOString() : null,
    distinctActions: actions.map((a) => a.v).sort(),
    distinctResourceTypes: resourceTypes.map((r) => r.v).sort(),
  });
}
