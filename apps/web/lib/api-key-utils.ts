import { randomBytes, createHash } from "crypto";

export function generateApiKey(type: "publishable" | "secret", network: "live" | "test"): {
  key: string;
  prefix: string;
  hash: string;
} {
  const prefixMap = {
    publishable: { live: "pk_live_", test: "pk_test_" },
    secret: { live: "sk_live_", test: "sk_test_" },
  };
  const prefix = prefixMap[type][network];
  const random = randomBytes(24).toString("base64url");
  const key = `${prefix}${random}`;
  const hash = createHash("sha256").update(key).digest("hex");
  return { key, prefix: key.slice(0, 12), hash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export type VerifiableApiKey = {
  keyHash: string;
  previousKeyHash: string | null;
  expiresAt: Date | null;
};

export type VerifyMatch = "current" | "previous" | null;

/**
 * Decide whether a caller-supplied hash should be accepted for the given
 * api_keys row. Returns which hash matched so call-sites can decide whether
 * to emit a "using rotated key" signal.
 */
export function verifyApiKeyHash(
  row: VerifiableApiKey,
  suppliedHash: string,
  now: Date,
): VerifyMatch {
  if (suppliedHash === row.keyHash) return "current";
  if (
    row.previousKeyHash &&
    suppliedHash === row.previousKeyHash &&
    row.expiresAt &&
    row.expiresAt.getTime() > now.getTime()
  ) {
    return "previous";
  }
  return null;
}

export const API_KEY_GRACE_SECONDS = {
  none: 0,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
} as const;

export type ApiKeyGrace = keyof typeof API_KEY_GRACE_SECONDS;
