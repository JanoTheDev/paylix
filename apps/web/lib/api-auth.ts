import { db } from "./db";
import { apiKeys } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { hashApiKey } from "./api-key-utils";
import { checkRateLimitAsync } from "./rate-limit";
import { NextResponse } from "next/server";

export type ApiKeyAuth = {
  organizationId: string;
  keyType: "publishable" | "secret";
  rateLimitResponse?: undefined;
};

export type ApiKeyRateLimited = {
  rateLimitResponse: NextResponse;
};

export type ApiKeyResult = ApiKeyAuth | ApiKeyRateLimited | null;

export async function authenticateApiKey(
  request: Request,
  requiredType?: "publishable" | "secret"
): Promise<ApiKeyResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const key = authHeader.slice(7);
  const hash = hashApiKey(key);

  const [found] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.isActive, true)));

  if (!found) return null;

  if (requiredType && found.type !== requiredType) return null;

  const maxPerMinute = found.type === "publishable" ? 200 : 100;
  const rl = await checkRateLimitAsync(`api:${found.id}`, maxPerMinute, 60_000);
  if (!rl.ok) {
    const retryAfter = String(Math.ceil((rl.retryAfterMs ?? 0) / 1000));
    return {
      rateLimitResponse: NextResponse.json(
        { error: { code: "rate_limited", message: `Rate limit exceeded. Retry in ${retryAfter}s` } },
        { status: 429, headers: { "Retry-After": retryAfter } },
      ),
    };
  }

  // Fire-and-forget lastUsedAt update; don't block the request on it.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, found.id))
    .catch(() => {});

  return { organizationId: found.organizationId, keyType: found.type };
}
