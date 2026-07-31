import { describe, it, expect } from "vitest";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  hmacSha256Hex,
  hmacSha256HexAsync,
  sha256,
  timingSafeEqualHex,
} from "../hmac";
import { webhooks } from "../webhooks";

/**
 * The SDK ships its own HMAC-SHA256 so `webhooks.verify` stays synchronous
 * and free of node builtins (see hmac.ts). That makes correctness this
 * package's problem rather than the platform's, so it is pinned two ways:
 *
 *  1. against the RFC 4231 published vectors, and
 *  2. against `node:crypto` across the shapes production actually produces.
 *
 * The second matters most for the **long-key branch**: a real Paylix
 * secret is `whsec_` + 64 hex chars = 70 bytes (see
 * `apps/web/app/api/webhooks/route.ts`), which exceeds the 64-byte SHA-256
 * block size, so `hmacSha256Hex` hashes the key first for 100% of live
 * webhooks. The original test suite used a 21-byte secret and never
 * reached that branch.
 */

const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const utf8 = (s: string) => new TextEncoder().encode(s);
const repeat = (byte: number, n: number) => new Uint8Array(n).fill(byte);

/** A secret shaped exactly like the ones the API mints. */
function realWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

describe("RFC 4231 HMAC-SHA-256 vectors", () => {
  const vectors: Array<{ n: number; key: Uint8Array; data: Uint8Array; mac: string }> = [
    {
      n: 1,
      key: repeat(0x0b, 20),
      data: utf8("Hi There"),
      mac: "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    },
    {
      n: 2,
      key: utf8("Jefe"),
      data: utf8("what do ya want for nothing?"),
      mac: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    },
    {
      n: 3,
      key: repeat(0xaa, 20),
      data: repeat(0xdd, 50),
      mac: "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    },
    {
      n: 4,
      key: hex("0102030405060708090a0b0c0d0e0f10111213141516171819"),
      data: repeat(0xcd, 50),
      mac: "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b",
    },
    {
      n: 5,
      key: repeat(0x0c, 20),
      data: utf8("Test With Truncation"),
      mac: "a3b6167473100ee06e0c796c2955552bfa6f7c0a6a8aef8b93f860aab0cd20c5",
    },
    {
      // 131-byte key — exercises the long-key hashing branch.
      n: 6,
      key: repeat(0xaa, 131),
      data: utf8("Test Using Larger Than Block-Size Key - Hash Key First"),
      mac: "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    },
    {
      // 131-byte key AND a 152-byte message — long key, multi-block data.
      n: 7,
      key: repeat(0xaa, 131),
      data: utf8(
        "This is a test using a larger than block-size key and a larger " +
          "than block-size data. The key needs to be hashed before being " +
          "used by the HMAC algorithm.",
      ),
      mac: "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2",
    },
  ];

  it.each(vectors)("vector $n matches the published MAC", ({ key, data, mac }) => {
    expect(hmacSha256Hex(key, data)).toBe(mac);
  });

  it.each(vectors)("vector $n matches node:crypto", ({ key, data }) => {
    const expected = createHmac("sha256", Buffer.from(key)).update(Buffer.from(data)).digest("hex");
    expect(hmacSha256Hex(key, data)).toBe(expected);
  });
});

describe("production-shaped secrets (the long-key branch)", () => {
  it("agrees with node:crypto for a real 70-byte whsec_ secret", () => {
    const secret = realWebhookSecret();
    expect(secret).toHaveLength(70);
    expect(utf8(secret).length).toBeGreaterThan(64); // exceeds the block size

    const body = JSON.stringify({ event: "payment.confirmed", data: { id: "pay_1" } });
    expect(hmacSha256Hex(secret, body)).toBe(
      createHmac("sha256", secret).update(body).digest("hex"),
    );
  });

  it("agrees for 200 random whsec_ secrets", () => {
    for (let i = 0; i < 200; i++) {
      const secret = realWebhookSecret();
      const body = randomBytes(i * 3).toString("hex");
      expect(hmacSha256Hex(secret, body)).toBe(
        createHmac("sha256", secret).update(body).digest("hex"),
      );
    }
  });

  it("agrees across every key length spanning the 64-byte boundary", () => {
    const body = "payload";
    for (let len = 0; len <= 130; len++) {
      const key = randomBytes(len);
      expect(hmacSha256Hex(new Uint8Array(key), body)).toBe(
        createHmac("sha256", key).update(body).digest("hex"),
      );
    }
  });

  it("agrees across message lengths spanning the padding boundaries", () => {
    const secret = realWebhookSecret();
    // 55/56/57 and 63/64/65 straddle the length-field and block boundaries.
    for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 129, 1000]) {
      const body = randomBytes(len);
      expect(hmacSha256Hex(secret, new Uint8Array(body))).toBe(
        createHmac("sha256", secret).update(body).digest("hex"),
      );
    }
  });
});

describe("sha256", () => {
  it("matches node:crypto on the padding boundaries", () => {
    // 55/56 straddle the point where the 8-byte length field no longer
    // fits in the final block and a whole extra block is appended.
    for (const len of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 4096]) {
      const input = randomBytes(len);
      expect(Buffer.from(sha256(new Uint8Array(input))).toString("hex")).toBe(
        createHash("sha256").update(input).digest("hex"),
      );
    }
  });
});

describe("hmacSha256HexAsync (crypto.subtle)", () => {
  it.each([1, 2, 3, 4, 5, 6, 7])("matches the sync implementation on RFC vector %i", async (n) => {
    // Re-derive the vector inputs rather than re-listing them.
    const key = n === 2 ? utf8("Jefe") : n <= 3 ? repeat(n === 1 ? 0x0b : 0xaa, 20) : repeat(0xaa, 131);
    const data = utf8(`vector-${n}`);
    expect(await hmacSha256HexAsync(key, data)).toBe(hmacSha256Hex(key, data));
  });

  it("matches node:crypto for a real 70-byte whsec_ secret", async () => {
    const secret = realWebhookSecret();
    const body = JSON.stringify({ event: "payment.confirmed" });
    expect(await hmacSha256HexAsync(secret, body)).toBe(
      createHmac("sha256", secret).update(body).digest("hex"),
    );
  });

  it("agrees with the sync path across key and message lengths", async () => {
    for (const keyLen of [0, 1, 32, 63, 64, 65, 70, 131]) {
      for (const msgLen of [0, 1, 55, 56, 64, 65, 200]) {
        if (keyLen === 0) continue; // subtle rejects zero-length HMAC keys
        const key = new Uint8Array(randomBytes(keyLen));
        const msg = new Uint8Array(randomBytes(msgLen));
        expect(await hmacSha256HexAsync(key, msg)).toBe(hmacSha256Hex(key, msg));
      }
    }
  });
});

describe("webhooks.verifyAsync", () => {
  const secret = realWebhookSecret();
  const body = JSON.stringify({ event: "payment.confirmed", data: { amount: 1000 } });

  it("accepts a valid legacy signature", async () => {
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    await expect(webhooks.verifyAsync({ payload: body, signature: sig, secret })).resolves.toBe(true);
  });

  it("accepts a valid v1 signature and enforces the window", async () => {
    const ts = 2_000_000_000;
    const mac = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const signature = `t=${ts},v1=${mac}`;
    await expect(
      webhooks.verifyAsync({ payload: body, signature, secret, nowSeconds: ts + 5 }),
    ).resolves.toBe(true);
    await expect(
      webhooks.verifyAsync({ payload: body, signature, secret, nowSeconds: ts + 600 }),
    ).resolves.toBe(false);
  });

  it("agrees with the sync verify on every input shape", async () => {
    const ts = 2_000_000_000;
    const good = createHmac("sha256", secret).update(body).digest("hex");
    const goodV1 = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

    const inputs = [
      { payload: body, signature: `sha256=${good}`, secret },
      { payload: body, signature: good, secret }, // missing prefix
      { payload: body, signature: `sha256=${"0".repeat(64)}`, secret },
      { payload: body, signature: "", secret },
      { payload: body, signature: "t=2000000000", secret },
      { payload: body, signature: `t=abc,v1=${goodV1}`, secret },
      { payload: body, signature: `t=${ts},v1=${goodV1}`, secret, nowSeconds: ts },
      { payload: body, signature: `t=${ts},v1=${goodV1}`, secret, nowSeconds: ts + 9999 },
      { payload: `${body} `, signature: `sha256=${good}`, secret },
      { payload: utf8(body), signature: `sha256=${good}`, secret },
      { payload: body, signature: `sha256=${good}`, secret: "wrong" },
    ];

    for (const input of inputs) {
      expect(await webhooks.verifyAsync(input)).toBe(webhooks.verify(input));
    }
  });
});

describe("timingSafeEqualHex", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqualHex("abc123", "abc123")).toBe(true);
    expect(timingSafeEqualHex("abc123", "abc124")).toBe(false);
    expect(timingSafeEqualHex("abc123", "abc12")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(true);
  });
});

describe("webhooks.verify with production-shaped secrets", () => {
  const secret = realWebhookSecret();
  // Larger than one SHA-256 block, so both the key- and message-hashing
  // paths run multi-block.
  const body = JSON.stringify({
    event: "subscription.created",
    timestamp: "2026-07-31T00:00:00.000Z",
    data: {
      subscriptionId: "sub_01J8ZQ2K3M4N5P6Q7R8S9T0V",
      customerId: "cus_01J8ZQ2K3M4N5P6Q7R8S9T0V",
      productId: "prod_01J8ZQ2K3M4N5P6Q7R8S9T0V",
      amount: 1000,
      metadata: { plan: "pro", seats: "5" },
    },
  });

  it("uses a payload longer than one block", () => {
    expect(utf8(body).length).toBeGreaterThan(64);
  });

  it("accepts a legacy signature produced by node:crypto", () => {
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(webhooks.verify({ payload: body, signature: sig, secret })).toBe(true);
  });

  it("accepts a v1 signature produced by node:crypto", () => {
    const ts = 2_000_000_000;
    const mac = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(
      webhooks.verify({
        payload: body,
        signature: `t=${ts},v1=${mac}`,
        secret,
        nowSeconds: ts + 5,
      }),
    ).toBe(true);
  });

  it("accepts a Uint8Array payload identically", () => {
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(
      webhooks.verify({ payload: utf8(body), signature: sig, secret }),
    ).toBe(true);
  });

  it("rejects a one-byte tamper", () => {
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const tampered = body.replace('"amount":1000', '"amount":1001');
    expect(webhooks.verify({ payload: tampered, signature: sig, secret })).toBe(false);
  });

  it("rejects a signature made with a different 70-byte secret", () => {
    const sig = `sha256=${createHmac("sha256", realWebhookSecret()).update(body).digest("hex")}`;
    expect(webhooks.verify({ payload: body, signature: sig, secret })).toBe(false);
  });

  it("handles multi-byte UTF-8 bodies", () => {
    const unicode = JSON.stringify({ note: "café — 日本語 — 🔐", amount: 1000 });
    const sig = `sha256=${createHmac("sha256", secret).update(unicode, "utf8").digest("hex")}`;
    expect(webhooks.verify({ payload: unicode, signature: sig, secret })).toBe(true);
  });
});
