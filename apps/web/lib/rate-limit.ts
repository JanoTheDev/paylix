/**
 * Rate limiter with Redis support for multi-instance deployments.
 *
 * When REDIS_URL is set, `checkRateLimitAsync` uses atomic Redis INCR+EXPIRE
 * for distributed rate limiting. Falls back to in-memory on Redis failure.
 *
 * The synchronous `checkRateLimit` always uses the in-memory path and is kept
 * for callers that can't await.
 */

import { getRedis } from "./redis";

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs?: number;
  remaining: number;
}

/**
 * Check whether `key` can make another request under `limit` per `windowMs`.
 * Increments the counter if allowed.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    // New window
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    const retryAfterMs = windowMs - (now - bucket.windowStart);
    return { ok: false, retryAfterMs, remaining: 0 };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count };
}

/**
 * Clear a key's bucket (e.g., after a successful operation that shouldn't
 * count against the limit in the traditional sense). Rarely needed — most
 * callers just let the window expire naturally.
 */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Async rate limiter that tries Redis first (when REDIS_URL is set),
 * falling back to in-memory on any error or when Redis is unavailable.
 */
export async function checkRateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (redis) {
    try {
      const windowSec = Math.ceil(windowMs / 1000);
      const redisKey = `rl:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, windowSec);
      }
      if (count > limit) {
        const ttl = await redis.ttl(redisKey);
        return { ok: false, retryAfterMs: ttl * 1000, remaining: 0 };
      }
      return { ok: true, remaining: limit - count };
    } catch {
      // Redis failed — fall through to in-memory
    }
  }
  return checkRateLimit(key, limit, windowMs);
}

/**
 * For tests.
 */
export function __clearAllBuckets(): void {
  buckets.clear();
}
