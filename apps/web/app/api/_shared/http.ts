/**
 * Request/response helpers shared by every route under `app/api`.
 *
 * Extracted because the audit counted the same three blocks copy-pasted
 * across the API surface:
 *   - `catch → apiError("invalid_body")`      (10×)
 *   - `zod issues → apiError("validation_failed")` (many)
 *   - success envelopes in four different shapes
 *
 * Keeping them here (rather than in `lib/`) keeps the API layer's own
 * conventions next to the routes that use them.
 */

import { NextResponse } from "next/server";
import type { z } from "zod";
import { apiError } from "@/lib/api-error";

export type BodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/**
 * `await request.json()` with the 400 that every route forgot to write.
 * Never throws — a malformed body is a client error, not a 500.
 */
export async function readJsonBody(
  request: Request,
): Promise<BodyResult<unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError("invalid_body", "Request body must be valid JSON.", 400),
    };
  }
  return { ok: true, data: raw };
}

/** Same contract as {@link readJsonBody} for the already-buffered body that
 *  `withIdempotency` hands to its callback. */
export function parseJsonBody(rawBody: string): BodyResult<unknown> {
  if (rawBody.length === 0) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(rawBody) };
  } catch {
    return {
      ok: false,
      response: apiError("invalid_body", "Request body must be valid JSON.", 400),
    };
  }
}

/** Uniform `validation_failed` response built from a zod error. */
export function validationFailed(error: z.ZodError): NextResponse {
  return apiError(
    "validation_failed",
    error.issues.map((i) => i.message).join("; "),
  );
}

/**
 * Parse `body` with `schema`, returning the uniform 400 on failure.
 * Collapses the `safeParse` + issue-join dance repeated in ~20 routes.
 */
export function parseWith<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): BodyResult<z.infer<T>> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: validationFailed(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

/** Canonical "this write succeeded and has nothing to return" envelope. */
export function apiOk(
  extra: Record<string, unknown> = {},
  status = 200,
): NextResponse {
  return NextResponse.json({ ok: true, ...extra }, { status });
}
