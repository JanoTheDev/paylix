import { db } from "@/lib/db";
import { auditLogs } from "@paylix/db/schema";

/**
 * Keys whose values must never be persisted to the audit log. `details` is
 * assembled ad hoc at ~15 call sites, so redaction happens here rather than
 * relying on every caller to remember. Matching is substring + case
 * insensitive so `keyHash`, `previousKeyHash` and `webhookSecret` all hit.
 */
const REDACT_KEY_PATTERN =
  /(secret|password|token|apikey|api_key|keyhash|key_hash|signature|privatekey|private_key|mnemonic|authorization|cookie)/i;

const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 4;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  }
  if (value && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

function redactRecord(
  input: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = REDACT_KEY_PATTERN.test(key)
      ? "[redacted]"
      : redactValue(value, depth);
  }
  return out;
}

/** Exported for tests and for callers that log details elsewhere. */
export function redactAuditDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return details ? redactRecord(details) : {};
}

export async function recordAudit(args: {
  organizationId: string;
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: args.organizationId,
      userId: args.userId ?? null,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId ?? null,
      details: redactAuditDetails(args.details),
      ipAddress: args.ipAddress ?? null,
    });
  } catch (err) {
    // Log the message only — a driver error can carry the full failed
    // INSERT, details payload included.
    console.error(
      "[Audit] Failed to record:",
      err instanceof Error ? err.message : "unknown error",
    );
  }
}
