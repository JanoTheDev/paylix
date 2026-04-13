import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { apiKeys } from "@paylix/db/schema";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { generateApiKey } from "@/lib/api-key-utils";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["publishable", "secret"]),
});

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      type: apiKeys.type,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      livemode: apiKeys.livemode,
    })
    .from(apiKeys)
    .where(orgScope(apiKeys, { organizationId, livemode }))
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const body = await request.json();
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join("; ");
    return apiError("validation_failed", issues);
  }

  const { name, type } = parsed.data;
  const { key, prefix, hash } = generateApiKey(type, livemode ? "live" : "test");

  const [row] = await db
    .insert(apiKeys)
    .values({
      organizationId,
      livemode,
      name,
      keyHash: hash,
      prefix,
      type,
    })
    .returning();

  void recordAudit({
    organizationId,
    userId,
    action: "api_key.created",
    resourceType: "api_key",
    resourceId: row.id,
    details: { name: row.name, type: row.type },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ ...row, key }, { status: 201 });
}
