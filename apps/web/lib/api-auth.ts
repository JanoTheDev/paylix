import { db } from "./db";
import { apiKeys } from "@paylix/db/schema";
import { eq, and, or } from "drizzle-orm";
import { hashApiKey, verifyApiKeyHash } from "./api-key-utils";
import { checkRateLimitAsync } from "./rate-limit";
import { NextResponse } from "next/server";

export type ApiKeyAuth = {
  organizationId: string;
  keyType: "publishable" | "secret";
  livemode: boolean;
  rateLimitResponse?: undefined;
};

export type ApiKeyRateLimited = {
  rateLimitResponse: NextResponse;
};

export type ApiKeyResult = ApiKeyAuth | ApiKeyRateLimited | null;

export async function authenticateApiKey(
  request: Request,
  requiredType?: "publishable" | "secret",
  routeLimit?: { key: string; perMinute: number },
): Promise<ApiKeyResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const key = authHeader.slice(7);
  const hash = hashApiKey(key);

  // Rotation support: accept either the current key_hash OR a previous
  // key_hash whose grace period hasn't elapsed. verifyApiKeyHash below
  // enforces the expires_at window even if both columns collide.
  const [found] = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        or(eq(apiKeys.keyHash, hash), eq(apiKeys.previousKeyHash, hash)),
        eq(apiKeys.isActive, true),
      ),
    );

  if (!found) return null;

  const match = verifyApiKeyHash(
    { keyHash: found.keyHash, previousKeyHash: found.previousKeyHash, expiresAt: found.expiresAt },
    hash,
    new Date(),
  );
  if (!match) return null;

  if (requiredType && found.type !== requiredType) return null;

  const livemode = found.livemode;
  const baseLimit = found.type === "publishable" ? 200 : 100;
  const maxPerMinute = livemode ? baseLimit : Math.floor(baseLimit * 2.5);
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

  if (routeLimit) {
    const routeRl = await checkRateLimitAsync(
      `${routeLimit.key}:${found.id}`,
      routeLimit.perMinute,
      60_000,
    );
    if (!routeRl.ok) {
      const retryAfter = String(Math.ceil((routeRl.retryAfterMs ?? 0) / 1000));
      return {
        rateLimitResponse: NextResponse.json(
          {
            error: {
              code: "rate_limited",
              message: `Rate limit exceeded for ${routeLimit.key}. Retry in ${retryAfter}s`,
            },
          },
          { status: 429, headers: { "Retry-After": retryAfter } },
        ),
      };
    }
  }

  // Fire-and-forget lastUsedAt update; don't block the request on it.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, found.id))
    .catch(() => {});

  return { organizationId: found.organizationId, keyType: found.type, livemode };
}
