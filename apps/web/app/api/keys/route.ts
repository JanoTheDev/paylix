import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { apiKeys } from "@paylix/db/schema";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { generateApiKey } from "@/lib/api-key-utils";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "../_shared/client-ip";
import { readJsonBody, parseWith } from "../_shared/http";
import { requireRole } from "../_shared/roles";

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
      previousKeyPrefix: apiKeys.previousKeyPrefix,
      rotatedAt: apiKeys.rotatedAt,
      expiresAt: apiKeys.expiresAt,
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

  // Minting an `sk_live_` key hands out full API access to the org's money.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseWith(createKeySchema, body.data);
  if (!parsed.ok) return parsed.response;

  const { name, type } = parsed.data;
  const { key, prefix, hash } = generateApiKey(type, livemode ? "live" : "test");

  // Explicit projection. `.returning()` with no column list put `keyHash`
  // (and `previousKeyHash`) in the response body — and `authenticateApiKey`
  // looks keys up by `eq(apiKeys.keyHash, hash)`, so the hash *is* the
  // credential as far as that query is concerned.
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
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      type: apiKeys.type,
      isActive: apiKeys.isActive,
      livemode: apiKeys.livemode,
      createdAt: apiKeys.createdAt,
    });

  void recordAudit({
    organizationId,
    userId,
    action: "api_key.created",
    resourceType: "api_key",
    resourceId: row.id,
    details: { name: row.name, type: row.type },
    ipAddress: clientIp(request),
  });

  return NextResponse.json({ ...row, key }, { status: 201 });
}
