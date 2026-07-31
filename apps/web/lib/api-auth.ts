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

/**
 * Derive the key's capabilities from its prefix.
 *
 *   pk_live_ / pk_test_ — publishable, safe to embed in client code
 *   sk_live_ / sk_test_ — secret, server-only, full access
 *
 * Anything else is unrecognised and must be rejected. The prefix — not the
 * DB row alone — is the contract the middleware advertises, so the two have
 * to agree before the key is honoured.
 */
export function parseApiKeyPrefix(
  key: string,
): { keyType: "publishable" | "secret"; livemode: boolean } | null {
  const m = /^(pk|sk)_(live|test)_[A-Za-z0-9_-]{16,}$/.exec(key);
  if (!m) return null;
  return {
    keyType: m[1] === "pk" ? "publishable" : "secret",
    livemode: m[2] === "live",
  };
}

export async function authenticateApiKey(
  request: Request,
  // Fail closed: callers that genuinely want to accept a client-embeddable
  // publishable key must say so explicitly.
  requiredType: "publishable" | "secret" = "secret",
  routeLimit?: { key: string; perMinute: number },
): Promise<ApiKeyResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const key = authHeader.slice(7).trim();
  const claimed = parseApiKeyPrefix(key);
  if (!claimed) return null; // unrecognised prefix → deny
  if (claimed.keyType !== requiredType) return null;

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

  // The stored row and the presented prefix must agree on both capability and
  // mode. A mismatch means the row was tampered with or minted incorrectly —
  // either way, deny rather than pick a winner.
  if (found.type !== requiredType) return null;
  if (found.type !== claimed.keyType) return null;
  if (found.livemode !== claimed.livemode) return null;

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
