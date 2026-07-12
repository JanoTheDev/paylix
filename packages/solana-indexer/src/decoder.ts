/**
 * Anchor event decoder.
 *
 * Anchor emits events by prepending `Program data: <base64>` to the program
 * log. The payload format is:
 *   8-byte discriminator (sha256("event:<EventName>")[0..8]) +
 *   Borsh-serialized event fields.
 *
 * We pre-compute discriminators for the four events the Paylix programs
 * emit, match on the leading 8 bytes, and Borsh-decode the rest. This keeps
 * the indexer dep-free of Anchor's IDL runtime — the event schemas here
 * must stay in sync with the `#[event]` structs in the Rust programs.
 */

import { sha256 } from "@noble/hashes/sha2.js";

export type EventKind =
  | "PaymentReceived"
  | "SubscriptionCreated"
  | "SubscriptionCharged"
  | "SubscriptionCancelled";

export interface PaymentReceivedEvent {
  kind: "PaymentReceived";
  buyer: string;
  merchant: string;
  mint: string;
  amount: bigint;
  fee: bigint;
  productId: string;
  customerId: string;
}
export interface SubscriptionCreatedEvent {
  kind: "SubscriptionCreated";
  subscriptionId: bigint;
  subscriber: string;
  merchantAta: string;
  mint: string;
  amount: bigint;
  intervalSeconds: bigint;
  productId: string;
  customerId: string;
}
export interface SubscriptionChargedEvent {
  kind: "SubscriptionCharged";
  subscriptionId: bigint;
  subscriber: string;
  merchantAta: string;
  mint: string;
  amount: bigint;
}
export interface SubscriptionCancelledEvent {
  kind: "SubscriptionCancelled";
  subscriptionId: bigint;
}

export type DecodedEvent =
  | PaymentReceivedEvent
  | SubscriptionCreatedEvent
  | SubscriptionChargedEvent
  | SubscriptionCancelledEvent;

const DISCRIMINATORS = new Map<string, EventKind>();
for (const name of [
  "PaymentReceived",
  "SubscriptionCreated",
  "SubscriptionCharged",
  "SubscriptionCancelled",
] as const) {
  const hash = sha256(new TextEncoder().encode(`event:${name}`));
  const disc = Buffer.from(hash).subarray(0, 8).toString("hex");
  DISCRIMINATORS.set(disc, name);
}

/** Borsh reader — only the primitives Paylix events use. */
export class BorshReader {
  private offset = 0;
  constructor(private buf: Buffer) {}

  pubkey(): string {
    const slice = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return bs58Encode(slice);
  }
  u64(): bigint {
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  i64(): bigint {
    const v = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  bytes32(): string {
    const slice = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return "0x" + slice.toString("hex");
  }
  u8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
}

// Minimal base58 encoder (Solana addresses). Avoids adding bs58 as a dep.
const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

/** Decode one `Program data: <base64>` log line. Returns null on unknown discriminator. */
export function decodeProgramData(base64Payload: string): DecodedEvent | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64Payload, "base64");
  } catch {
    return null;
  }
  if (buf.length < 8) return null;

  const disc = buf.subarray(0, 8).toString("hex");
  const kind = DISCRIMINATORS.get(disc);
  if (!kind) return null;

  const reader = new BorshReader(buf.subarray(8));
  switch (kind) {
    case "PaymentReceived":
      return {
        kind,
        buyer: reader.pubkey(),
        merchant: reader.pubkey(),
        mint: reader.pubkey(),
        amount: reader.u64(),
        fee: reader.u64(),
        productId: reader.bytes32(),
        customerId: reader.bytes32(),
      };
    case "SubscriptionCreated":
      return {
        kind,
        subscriptionId: reader.u64(),
        subscriber: reader.pubkey(),
        merchantAta: reader.pubkey(),
        mint: reader.pubkey(),
        amount: reader.u64(),
        intervalSeconds: reader.i64(),
        productId: reader.bytes32(),
        customerId: reader.bytes32(),
      };
    case "SubscriptionCharged":
      return {
        kind,
        subscriptionId: reader.u64(),
        subscriber: reader.pubkey(),
        merchantAta: reader.pubkey(),
        mint: reader.pubkey(),
        amount: reader.u64(),
      };
    case "SubscriptionCancelled":
      return {
        kind,
        subscriptionId: reader.u64(),
      };
  }
}
