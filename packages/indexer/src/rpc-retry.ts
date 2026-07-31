export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate limit|too many requests|exceeded|throttle/i.test(msg);
}

/**
 * Wraps an RPC call with exponential backoff on rate-limit errors. Non-rate-limit
 * errors are thrown immediately so they can be handled as genuine failures.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 6,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (!isRateLimitError(err) || attempt >= maxAttempts) throw err;
      const delayMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
      console.warn(
        `[Listener] ${label}: rate-limited, backing off ${delayMs}ms (attempt ${attempt}/${maxAttempts})`
      );
      await sleepFn(delayMs);
    }
  }
}

/**
 * Retries a chunk read on non-rate-limit failures (timeouts, 502s, malformed
 * responses) with exponential backoff. Rate-limit backoff is handled a level
 * down by withRateLimitRetry. Throws once the attempts are exhausted — the
 * caller must then leave the cursor where it is.
 */
export async function withChunkRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options: {
    maxAttempts?: number;
    isStopped?: () => boolean;
    sleepFn?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const { maxAttempts = 3, isStopped = () => false, sleepFn = sleep } = options;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      // Rate limits already went through withRateLimitRetry's backoff — don't
      // multiply the attempts, just surface it so the window stops.
      if (attempt >= maxAttempts || isStopped() || isRateLimitError(err)) throw err;
      const delayMs = Math.min(10_000, 500 * 2 ** (attempt - 1));
      console.warn(
        `[Listener] ${label}: chunk read failed, retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts}):`,
        err instanceof Error ? err.message : err
      );
      await sleepFn(delayMs);
    }
  }
}
