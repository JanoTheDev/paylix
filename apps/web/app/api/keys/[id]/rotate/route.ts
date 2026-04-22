import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { apiKeys } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import {
  API_KEY_GRACE_SECONDS,
  generateApiKey,
  type ApiKeyGrace,
} from "@/lib/api-key-utils";
import { withIdempotency } from "@/lib/idempotency";

const rotateSchema = z.object({
  grace: z.enum(["none", "24h", "7d"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;

  return withIdempotency(request, organizationId, async (rawBody) => {
    let body: unknown;
    try {
      body = rawBody.length > 0 ? JSON.parse(rawBody) : null;
    } catch {
      return apiError("invalid_body", "Request body must be valid JSON.", 400);
    }
    const parsed = rotateSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join("; ");
      return apiError("validation_failed", issues);
    }
    const grace: ApiKeyGrace = parsed.data.grace;
    const graceSeconds = API_KEY_GRACE_SECONDS[grace];

    const [existing] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), orgScope(apiKeys, { organizationId, livemode })));
    if (!existing) return apiError("not_found", "Not found", 404);
    if (!existing.isActive) {
      return apiError("invalid_state", "Cannot rotate a revoked key");
    }

    const network: "live" | "test" = existing.livemode ? "live" : "test";
    const { key, prefix, hash } = generateApiKey(existing.type, network);

    const now = new Date();
    // Grace "none" means the old hash is invalid immediately; use a past
    // expiresAt so verifyApiKeyHash rejects it even before the next sweep.
    const expiresAt =
      graceSeconds === 0 ? now : new Date(now.getTime() + graceSeconds * 1000);

    const [updated] = await db
      .update(apiKeys)
      .set({
        keyHash: hash,
        prefix,
        previousKeyHash: existing.keyHash,
        previousKeyPrefix: existing.prefix,
        rotatedAt: now,
        expiresAt,
      })
      .where(eq(apiKeys.id, id))
      .returning();

    void recordAudit({
      organizationId,
      userId,
      action: "api_key.rotated",
      resourceType: "api_key",
      resourceId: id,
      details: { grace, expiresAt: expiresAt.toISOString() },
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    return NextResponse.json({
      id: updated.id,
      key,
      prefix: updated.prefix,
      previousKeyPrefix: updated.previousKeyPrefix,
      rotatedAt: updated.rotatedAt,
      expiresAt: updated.expiresAt,
    });
  });
}
