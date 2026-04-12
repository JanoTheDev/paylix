import { describe, it, expect } from "vitest";
import { hashRequestBody, evaluateIdempotency } from "../idempotency";

describe("hashRequestBody", () => {
  it("is deterministic for identical bodies", () => {
    expect(hashRequestBody('{"a":1}')).toBe(hashRequestBody('{"a":1}'));
  });
  it("differs for different bodies", () => {
    expect(hashRequestBody('{"a":1}')).not.toBe(hashRequestBody('{"a":2}'));
  });
  it("produces a 64-char hex string", () => {
    expect(hashRequestBody("hello")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("evaluateIdempotency", () => {
  const hash = "deadbeef";

  it("returns 'miss' when no row exists", () => {
    const result = evaluateIdempotency({ existing: null, requestHash: hash });
    expect(result.kind).toBe("miss");
  });

  it("returns 'hit' when row exists with matching hash", () => {
    const result = evaluateIdempotency({
      existing: { requestHash: hash, responseStatus: 200, responseBody: { ok: true } },
      requestHash: hash,
    });
    expect(result).toEqual({
      kind: "hit",
      responseStatus: 200,
      responseBody: { ok: true },
    });
  });

  it("returns 'conflict' when row exists with different hash", () => {
    const result = evaluateIdempotency({
      existing: { requestHash: "other", responseStatus: 200, responseBody: {} },
      requestHash: hash,
    });
    expect(result.kind).toBe("conflict");
  });
});
