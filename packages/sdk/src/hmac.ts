/**
 * Dependency-free, synchronous HMAC-SHA256.
 *
 * Why not `node:crypto`? `webhooks.verify` is re-exported from the package
 * root, so importing a Node builtin here would break every browser bundle,
 * Cloudflare Worker, and Next.js edge route that imports `@paylix/sdk` at
 * all — even ones that never verify a webhook. WebCrypto would work in
 * those runtimes but only exposes an async API, and `verify()` is
 * synchronous in the published contract.
 *
 * ~200 lines of well-specified arithmetic buys full runtime portability
 * with zero dependencies. `__tests__/webhooks.test.ts` cross-checks every
 * digest against `node:crypto`'s `createHmac`.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const BLOCK_SIZE = 64;
const DIGEST_SIZE = 32;

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 over `message`, returning 32 raw bytes. */
export function sha256(message: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pad: 0x80, then zeros, then the 64-bit big-endian bit length.
  const bitLength = message.length * 8;
  const paddedLength = ((message.length + 9 + 63) >>> 6) << 6;
  const buf = new Uint8Array(paddedLength);
  buf.set(message);
  buf[message.length] = 0x80;
  // Lengths above 2^53 bits are not representable in a JS number and are
  // far beyond any webhook body, so only the low 48 bits are written.
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += BLOCK_SIZE) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const digest = new Uint8Array(DIGEST_SIZE);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) digestView.setUint32(i * 4, h[i], false);
  return digest;
}

const encoder = new TextEncoder();

/** UTF-8 encodes a string, or passes bytes through unchanged. */
export function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? encoder.encode(value) : value;
}

/** HMAC-SHA256, returned as lowercase hex. */
export function hmacSha256Hex(
  key: string | Uint8Array,
  message: string | Uint8Array,
): string {
  let keyBytes = toBytes(key);
  if (keyBytes.length > BLOCK_SIZE) keyBytes = sha256(keyBytes);

  const inner = new Uint8Array(BLOCK_SIZE);
  const outer = new Uint8Array(BLOCK_SIZE);
  inner.set(keyBytes);
  outer.set(keyBytes);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    inner[i] ^= 0x36;
    outer[i] ^= 0x5c;
  }

  const messageBytes = toBytes(message);
  const innerInput = new Uint8Array(BLOCK_SIZE + messageBytes.length);
  innerInput.set(inner);
  innerInput.set(messageBytes, BLOCK_SIZE);
  const innerDigest = sha256(innerInput);

  const outerInput = new Uint8Array(BLOCK_SIZE + DIGEST_SIZE);
  outerInput.set(outer);
  outerInput.set(innerDigest, BLOCK_SIZE);

  return toHex(sha256(outerInput));
}

/**
 * HMAC-SHA256 via the platform's WebCrypto, returned as lowercase hex.
 *
 * Prefer this over {@link hmacSha256Hex} where an `await` is acceptable:
 * it hands the primitive to an audited, usually native implementation
 * instead of the bundled one. `crypto.subtle` only exposes an async API,
 * which is the sole reason the synchronous fallback exists.
 *
 * Available on Node 18+, Deno, Bun, Cloudflare Workers, and browsers on a
 * secure origin. Throws if `crypto.subtle` is missing.
 */
export async function hmacSha256HexAsync(
  key: string | Uint8Array,
  message: string | Uint8Array,
): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Paylix: crypto.subtle is unavailable in this runtime. Use the synchronous webhooks.verify() instead.",
    );
  }
  const cryptoKey = await subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign("HMAC", cryptoKey, toArrayBuffer(message));
  return toHex(new Uint8Array(signature));
}

/**
 * Copies into a standalone `ArrayBuffer`.
 *
 * `crypto.subtle` wants a `BufferSource`, and since TypeScript 5.7 a
 * `Uint8Array` is generic over `ArrayBufferLike` — which admits
 * `SharedArrayBuffer` and so does not satisfy `BufferSource`. Copying is
 * also what makes a view into a pooled Node `Buffer` safe to hand to an
 * async API.
 */
function toArrayBuffer(value: string | Uint8Array): ArrayBuffer {
  const bytes = toBytes(value);
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Length-independent, content-constant-time comparison of two hex strings.
 * Returns `false` immediately on a length mismatch — the length of a
 * signature is not a secret.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
