import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { blocklistEntries } from "@paylix/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { normalizeEmail } from "@/lib/email-normalize";
import { withIdempotency } from "@/lib/idempotency";

const createSchema = z.object({
  type: z.enum(["wallet", "email", "country"]),
  value: z.string().min(1).max(256),
  reason: z.string().max(256).optional(),
});

function canonicalize(
  type: "wallet" | "email" | "country",
  value: string,
): string {
  const trimmed = value.trim();
  if (type === "wallet") return trimmed.toLowerCase();
  if (type === "country") return trimmed.toUpperCase();
  // email: full address → normalize; domain-only stays as-is lowercased
  const lower = trimmed.toLowerCase();
  if (!lower.includes("@")) return lower;
  return normalizeEmail(lower);
}

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const rows = await db
    .select()
    .from(blocklistEntries)
    .where(orgScope(blocklistEntries, { organizationId, livemode }))
    .orderBy(desc(blocklistEntries.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  return withIdempotency(request, organizationId, async (rawBody) => {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiError("invalid_body", "Request body must be valid JSON.", 400);
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "validation_failed",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

  const type = parsed.data.type;
  const value = canonicalize(type, parsed.data.value);

  if (type === "country" && !/^[A-Z]{2}$/.test(value)) {
    return apiError("validation_failed", "country must be a 2-letter ISO code");
  }
  if (type === "wallet" && !/^0x[0-9a-f]{40}$/.test(value)) {
    return apiError("validation_failed", "wallet must be a 0x-prefixed address");
  }

  const existing = await db
    .select({ id: blocklistEntries.id })
    .from(blocklistEntries)
    .where(
      and(
        eq(blocklistEntries.organizationId, organizationId),
        eq(blocklistEntries.type, type),
        eq(blocklistEntries.value, value),
        eq(blocklistEntries.livemode, livemode),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return apiError("duplicate", "This value is already on the blocklist", 409);
  }

  const [row] = await db
    .insert(blocklistEntries)
    .values({
      organizationId,
      type,
      value,
      reason: parsed.data.reason ?? null,
      createdBy: userId,
      livemode,
    })
    .returning();

  void recordAudit({
    organizationId,
    userId,
    action: "blocklist.entry_added",
    resourceType: "blocklist_entry",
    resourceId: row.id,
    details: { type, value },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

    return NextResponse.json(row, { status: 201 });
  });
}
