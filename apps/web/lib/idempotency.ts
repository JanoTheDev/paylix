import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { idempotencyKeys } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";

const TTL_MS = 24 * 60 * 60 * 1000;

export function hashRequestBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

type ExistingRow = {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
} | null;

export type IdempotencyResult =
  | { kind: "miss" }
  | { kind: "hit"; responseStatus: number; responseBody: unknown }
  | { kind: "conflict" };

export function evaluateIdempotency(input: {
  existing: ExistingRow;
  requestHash: string;
}): IdempotencyResult {
  if (!input.existing) return { kind: "miss" };
  if (input.existing.requestHash !== input.requestHash) return { kind: "conflict" };
  return {
    kind: "hit",
    responseStatus: input.existing.responseStatus,
    responseBody: input.existing.responseBody,
  };
}

export async function withIdempotency(
  request: Request,
  organizationId: string,
  handler: (rawBody: string) => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  const rawBody = await request.text();

  if (!key) {
    return handler(rawBody);
  }

  const requestHash = hashRequestBody(rawBody);

  const [existing] = await db
    .select({
      requestHash: idempotencyKeys.requestHash,
      responseStatus: idempotencyKeys.responseStatus,
      responseBody: idempotencyKeys.responseBody,
    })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.organizationId, organizationId), eq(idempotencyKeys.key, key)));

  const evaluation = evaluateIdempotency({ existing: existing ?? null, requestHash });

  if (evaluation.kind === "hit") {
    return NextResponse.json(evaluation.responseBody, { status: evaluation.responseStatus });
  }
  if (evaluation.kind === "conflict") {
    return NextResponse.json(
      {
        error: {
          code: "idempotency_key_reused",
          message: "Idempotency-Key was reused with a different request body.",
        },
      },
      { status: 409 },
    );
  }

  const response = await handler(rawBody);
  const clone = response.clone();
  let body: unknown = null;
  try {
    body = await clone.json();
  } catch {
    body = null;
  }

  await db
    .insert(idempotencyKeys)
    .values({
      organizationId,
      key,
      requestHash,
      responseStatus: response.status,
      responseBody: body as object,
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .onConflictDoNothing();

  return response;
}
