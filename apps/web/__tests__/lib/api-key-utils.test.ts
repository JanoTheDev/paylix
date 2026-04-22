import { describe, it, expect } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  verifyApiKeyHash,
  API_KEY_GRACE_SECONDS,
} from "../../lib/api-key-utils";

describe("generateApiKey", () => {
  it("generates publishable live key with pk_live_ prefix", () => {
    const { key, prefix, hash } = generateApiKey("publishable", "live");
    expect(key).toMatch(/^pk_live_/);
    expect(prefix).toBe(key.slice(0, 12));
    expect(hash).toHaveLength(64);
  });

  it("generates secret test key with sk_test_ prefix", () => {
    const { key } = generateApiKey("secret", "test");
    expect(key).toMatch(/^sk_test_/);
  });

  it("generates unique keys each time", () => {
    const a = generateApiKey("publishable", "test");
    const b = generateApiKey("publishable", "test");
    expect(a.key).not.toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("hashApiKey", () => {
  it("produces consistent hash for same input", () => {
    const hash1 = hashApiKey("pk_test_abc123");
    const hash2 = hashApiKey("pk_test_abc123");
    expect(hash1).toBe(hash2);
  });

  it("produces different hash for different input", () => {
    const hash1 = hashApiKey("pk_test_abc123");
    const hash2 = hashApiKey("pk_test_xyz789");
    expect(hash1).not.toBe(hash2);
  });

  it("returns 64-char hex string", () => {
    const hash = hashApiKey("sk_live_test");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("verifyApiKeyHash", () => {
  const now = new Date("2026-04-22T12:00:00Z");
  const currentHash = "a".repeat(64);
  const previousHash = "b".repeat(64);

  it("accepts the current key hash", () => {
    const row = { keyHash: currentHash, previousKeyHash: null, expiresAt: null };
    expect(verifyApiKeyHash(row, currentHash, now)).toBe("current");
  });

  it("rejects an unrelated hash", () => {
    const row = { keyHash: currentHash, previousKeyHash: null, expiresAt: null };
    expect(verifyApiKeyHash(row, "c".repeat(64), now)).toBeNull();
  });

  it("accepts the previous hash while expires_at is in the future", () => {
    const row = {
      keyHash: currentHash,
      previousKeyHash: previousHash,
      expiresAt: new Date(now.getTime() + 60 * 1000),
    };
    expect(verifyApiKeyHash(row, previousHash, now)).toBe("previous");
  });

  it("rejects the previous hash once expires_at has elapsed", () => {
    const row = {
      keyHash: currentHash,
      previousKeyHash: previousHash,
      expiresAt: new Date(now.getTime() - 1),
    };
    expect(verifyApiKeyHash(row, previousHash, now)).toBeNull();
  });

  it("rejects the previous hash when expires_at is null (grace=none)", () => {
    const row = {
      keyHash: currentHash,
      previousKeyHash: previousHash,
      expiresAt: null,
    };
    expect(verifyApiKeyHash(row, previousHash, now)).toBeNull();
  });

  it("grace=none maps to 0 seconds; 24h and 7d map to expected durations", () => {
    expect(API_KEY_GRACE_SECONDS.none).toBe(0);
    expect(API_KEY_GRACE_SECONDS["24h"]).toBe(86400);
    expect(API_KEY_GRACE_SECONDS["7d"]).toBe(604800);
  });
});
