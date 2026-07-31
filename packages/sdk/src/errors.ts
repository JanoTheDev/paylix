/**
 * Coarse classification of a Paylix failure. Switch on this instead of
 * regex-matching `error.message` — the message text is not part of the
 * SDK's stability contract, but `type`, `status`, and `code` are.
 *
 * | type              | typical cause                                       |
 * |-------------------|-----------------------------------------------------|
 * | `authentication`  | 401 — missing / revoked / malformed API key         |
 * | `permission`      | 403 — key lacks the capability (e.g. `pk_` on a     |
 * |                   |   secret-only route), or livemode mismatch          |
 * | `invalid_request` | 400 / 409 / 422 — your parameters were rejected     |
 * | `not_found`       | 404 / 405 — no such resource, or no such route      |
 * | `rate_limit`      | 429 — slow down; see `retryAfterSeconds`            |
 * | `api`             | 5xx — Paylix-side failure, safe to retry            |
 * | `connection`      | DNS failure, connection reset, TLS error            |
 * | `timeout`         | the request exceeded `PaylixConfig.timeoutMs`       |
 */
export type PaylixErrorType =
  | "authentication"
  | "permission"
  | "invalid_request"
  | "not_found"
  | "rate_limit"
  | "api"
  | "connection"
  | "timeout";

export interface PaylixErrorOptions {
  type: PaylixErrorType;
  /** HTTP status, or `0` when the request never produced a response. */
  status: number;
  /** Machine-readable code. Server-supplied when available, else derived from `status`. */
  code: string;
  /** HTTP method of the failed request. */
  method: string;
  /** Path (not including `backendUrl`) of the failed request. */
  path: string;
  /** Raw parsed response body, when the server sent one. */
  body?: unknown;
  /** Value of the `x-request-id` response header, when present. */
  requestId?: string;
  /** Parsed `Retry-After`, in seconds. Only set for 429 / 503. */
  retryAfterSeconds?: number;
  /** Underlying `fetch` rejection for `connection` / `timeout` errors. */
  cause?: unknown;
}

/**
 * Every failure thrown by the Paylix SDK — HTTP and network alike — is an
 * instance of this class, so a single `catch` can branch on `err.type`.
 *
 * ```ts
 * import { Paylix, PaylixError } from '@paylix/sdk'
 *
 * try {
 *   await paylix.createCheckout({ productId })
 * } catch (err) {
 *   if (err instanceof PaylixError) {
 *     if (err.type === 'rate_limit') await sleep(err.retryAfterSeconds ?? 1)
 *     else if (err.status === 404) return null
 *     console.error(err.code, err.status, err.body)
 *   }
 *   throw err
 * }
 * ```
 */
export class PaylixError extends Error {
  readonly type: PaylixErrorType;
  readonly status: number;
  readonly code: string;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: PaylixErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PaylixError";
    this.type = options.type;
    this.status = options.status;
    this.code = options.code;
    this.method = options.method;
    this.path = options.path;
    this.body = options.body;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    // Keeps `instanceof` working when the SDK is down-levelled to ES5 by a
    // consumer's bundler.
    Object.setPrototypeOf(this, PaylixError.prototype);
  }
}

/** Type guard for `PaylixError`, safe across duplicated module instances. */
export function isPaylixError(err: unknown): err is PaylixError {
  return (
    err instanceof PaylixError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: unknown }).name === "PaylixError" &&
      typeof (err as { status?: unknown }).status === "number")
  );
}

/** Maps an HTTP status onto a `PaylixErrorType`. */
export function errorTypeForStatus(status: number): PaylixErrorType {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404 || status === 405) return "not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "api";
  if (status >= 400) return "invalid_request";
  return "api";
}

/** Default machine-readable code when the server does not supply one. */
export function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    case 409:
      return "conflict";
    case 422:
      return "unprocessable_entity";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "api_error" : "http_error";
  }
}
