import type { PaylixConfig } from "./types";
import {
  PaylixError,
  defaultCodeForStatus,
  errorTypeForStatus,
} from "./errors";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Default per-request timeout. Node's `fetch` has none of its own. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Default number of *extra* attempts after the first one fails. */
export const DEFAULT_MAX_RETRIES = 2;
/** Base of the exponential backoff, in ms. */
const RETRY_BASE_DELAY_MS = 250;
/** Never wait longer than this between attempts. */
const RETRY_MAX_DELAY_MS = 8_000;

export interface RequestOptions {
  /** JSON request body. Omit for bodyless requests. */
  body?: unknown;
  /** Query string including the leading `?`, or `""`. */
  query?: string;
  /**
   * Idempotency key. Auto-generated for `POST` when omitted, so that a
   * replayed create is collapsed by the server's `withIdempotency`
   * wrapper. Pass `null` to suppress the header — do that for routes that
   * do **not** wrap themselves in `withIdempotency`, where advertising a
   * key would imply a guarantee the server does not honour.
   */
  idempotencyKey?: string | null;
  /**
   * Set `false` to disable retries for this request entirely, including
   * the 429 path. Required for accumulative endpoints: a route that adds
   * N days or advances a billing anchor applies twice if it is replayed,
   * and no client-side key can prevent that unless the server dedupes.
   */
  retry?: boolean;
}

interface NormalizedError {
  message: string;
  code?: string;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.replace(/\/+$/, "") : url;
}

/**
 * The API has emitted four different error envelopes over its lifetime.
 * Accept all of them rather than letting a precise validation message get
 * flattened into `"Bad Request"`.
 */
function normalizeErrorBody(body: unknown): NormalizedError | null {
  if (typeof body === "string" && body.trim()) return { message: body };
  if (typeof body !== "object" || body === null) return null;

  const record = body as Record<string, unknown>;
  const err = record.error;

  // { error: "Product not found" }
  if (typeof err === "string" && err.trim()) return { message: err };

  // { error: { code, message } }
  if (typeof err === "object" && err !== null) {
    const inner = err as Record<string, unknown>;
    const message =
      typeof inner.message === "string" ? inner.message : undefined;
    const code = typeof inner.code === "string" ? inner.code : undefined;
    if (message || code) return { message: message ?? code!, code };
  }

  // { message: "..." } / { detail: "..." }
  for (const key of ["message", "detail"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return { message: value };
  }

  return null;
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000));
  }
  return undefined;
}

function readHeader(res: Response, name: string): string | undefined {
  // Test doubles and some fetch polyfills omit `headers` entirely.
  const headers = (res as { headers?: { get?(k: string): string | null } })
    .headers;
  if (!headers || typeof headers.get !== "function") return undefined;
  return headers.get(name) ?? undefined;
}

async function readJson(res: Response): Promise<unknown> {
  if (typeof res.json !== "function") return undefined;
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function randomId(): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  // Non-cryptographic fallback for runtimes without WebCrypto. Uniqueness,
  // not unpredictability, is what an idempotency key needs.
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, retryAfterSeconds?: number): number {
  const exponential = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** attempt,
    RETRY_MAX_DELAY_MS,
  );
  const jitter = Math.random() * RETRY_BASE_DELAY_MS;
  const floor = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : 0;
  return Math.min(Math.max(exponential + jitter, floor), RETRY_MAX_DELAY_MS);
}

/**
 * Single HTTP entry point for every SDK module.
 *
 * Responsibilities, in order: build the URL and headers once, apply a
 * timeout, retry safe failures with jittered exponential backoff, normalize
 * whichever error envelope the server used, and throw a `PaylixError` that
 * carries the status, code, and body instead of a formatted string.
 */
export async function request<T>(
  config: PaylixConfig,
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${trimTrailingSlash(config.backendUrl)}${path}${options.query ?? ""}`;
  const doFetch = config.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new PaylixError(
      "Paylix: global fetch is unavailable. Use Node 18+ or pass a `fetch` implementation in PaylixConfig.",
      { type: "connection", status: 0, code: "no_fetch", method, path },
    );
  }

  const hasBody = options.body !== undefined;
  const idempotencyKey =
    options.idempotencyKey === null
      ? undefined
      : (options.idempotencyKey ?? (method === "POST" ? randomId() : undefined));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (hasBody) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // `retry: false` is an absolute veto: it outranks maxRetries, the 429
  // path, and the idempotency key. Used for endpoints whose effect
  // accumulates on replay (see `admin.ts`).
  const maxRetries =
    options.retry === false ? 0 : Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
  // A 429 is rejected by the rate limiter before the handler mutates
  // anything, so replaying it is safe. A 5xx or a dropped socket may
  // already have been applied server-side, so only replay those when the
  // verb is idempotent or the request carries a key the server dedupes on.
  const replaySafe =
    method === "GET" ||
    method === "PUT" ||
    method === "DELETE" ||
    idempotencyKey !== undefined;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;

    try {
      res = await doFetch(url, {
        method,
        headers,
        signal: controller.signal,
        ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (cause) {
      const aborted = controller.signal.aborted;
      if (replaySafe && attempt < maxRetries) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw new PaylixError(
        aborted
          ? `Paylix request timed out after ${timeoutMs}ms (${method} ${path})`
          : `Paylix could not reach ${url}: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
        {
          type: aborted ? "timeout" : "connection",
          status: 0,
          code: aborted ? "timeout" : "connection_error",
          method,
          path,
          cause,
        },
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      // 204s and empty bodies parse to `undefined`; callers typed `Promise<void>`
      // simply ignore it.
      return (await readJson(res)) as T;
    }

    const status = typeof res.status === "number" ? res.status : 0;
    const body = await readJson(res);
    const retryAfterSeconds = parseRetryAfter(readHeader(res, "retry-after"));

    const retryable =
      status === 429 || (replaySafe && status >= 500 && status <= 599);
    if (retryable && attempt < maxRetries) {
      await sleep(backoffDelay(attempt, retryAfterSeconds));
      continue;
    }

    const normalized = normalizeErrorBody(body);
    const statusText =
      typeof res.statusText === "string" && res.statusText ? res.statusText : "";
    const detail =
      normalized?.message ?? (statusText || `HTTP ${status || "error"}`);
    const suffix = status ? `${status} ${method} ${path}` : `${method} ${path}`;

    throw new PaylixError(`${detail} (${suffix})`, {
      type: errorTypeForStatus(status),
      status,
      code: normalized?.code ?? defaultCodeForStatus(status),
      method,
      path,
      body,
      requestId: readHeader(res, "x-request-id"),
      retryAfterSeconds,
    });
  }
}

/**
 * Serializes `?a=b&metadata[k]=v` filters. Shared by `listPayments` and
 * `listSubscriptions`, which accept the same filter grammar.
 */
export function buildQuery(params?: {
  customerId?: string;
  status?: string;
  limit?: number;
  metadata?: Record<string, string>;
}): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  if (params.customerId) qs.set("customerId", params.customerId);
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.metadata) {
    for (const [k, v] of Object.entries(params.metadata)) {
      qs.set(`metadata[${k}]`, v);
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}
