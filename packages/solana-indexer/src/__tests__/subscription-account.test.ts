import { describe, it, expect, vi } from "vitest";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { subscriptionPda, fetchSubscriptionAccount, fetchPlatformWallet } from "../subscription-account";

function buildSubscriptionAccountData(fields: {
  id: bigint;
  subscriber: PublicKey;
  merchantAta: PublicKey;
  mint: PublicKey;
  amount: bigint;
  intervalSeconds: bigint;
  nextChargeAt: bigint;
  status: number;
}): Buffer {
  const buf = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 8 + 8 + 8 + 32 + 32 + 8 + 1 + 1);
  let offset = 0;
  buf.write("00000000", offset, "hex"); // 8-byte discriminator, value irrelevant for decode
  offset += 8;
  buf.writeBigUInt64LE(fields.id, offset); offset += 8;
  fields.subscriber.toBuffer().copy(buf, offset); offset += 32;
  fields.merchantAta.toBuffer().copy(buf, offset); offset += 32;
  fields.mint.toBuffer().copy(buf, offset); offset += 32;
  buf.writeBigUInt64LE(fields.amount, offset); offset += 8;
  buf.writeBigInt64LE(fields.intervalSeconds, offset); offset += 8;
  buf.writeBigInt64LE(fields.nextChargeAt, offset); offset += 8;
  offset += 32; // product_id — zero-filled, unused
  offset += 32; // customer_id — zero-filled, unused
  buf.writeBigUInt64LE(0n, offset); offset += 8; // total_charged — unused
  buf.writeUInt8(fields.status, offset); offset += 1;
  buf.writeUInt8(0, offset); // bump — unused

  return buf;
}

describe("subscriptionPda", () => {
  it("derives the same PDA the Rust program uses (seeds = [\"sub\", id_le_bytes])", () => {
    const programId = Keypair.generate().publicKey;
    const pda = subscriptionPda(programId, 0n);
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(0n);
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("sub"), idBuf], programId);
    expect(pda.toBase58()).toBe(expected.toBase58());
  });
});

describe("fetchSubscriptionAccount", () => {
  it("decodes a Subscription account", async () => {
    const subscriber = Keypair.generate().publicKey;
    const merchantAta = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const data = buildSubscriptionAccountData({
      id: 42n,
      subscriber,
      merchantAta,
      mint,
      amount: 1_000_000n,
      intervalSeconds: 2_592_000n,
      nextChargeAt: 1_800_000_000n,
      status: 0,
    });

    const connection = {
      getAccountInfo: vi.fn(async () => ({ data, executable: false, lamports: 0, owner: PublicKey.default, rentEpoch: 0 })),
    } as unknown as Connection;

    const result = await fetchSubscriptionAccount(connection, Keypair.generate().publicKey);

    expect(result).toEqual({
      id: 42n,
      subscriber: subscriber.toBase58(),
      merchantAta: merchantAta.toBase58(),
      mint: mint.toBase58(),
      amount: 1_000_000n,
      intervalSeconds: 2_592_000n,
      nextChargeAt: 1_800_000_000n,
      status: 0,
    });
  });

  it("returns null when the account doesn't exist", async () => {
    const connection = {
      getAccountInfo: vi.fn(async () => null),
    } as unknown as Connection;

    const result = await fetchSubscriptionAccount(connection, Keypair.generate().publicKey);
    expect(result).toBeNull();
  });
});

describe("fetchPlatformWallet", () => {
  it("decodes the platform_wallet field from a config account", async () => {
    const owner = Keypair.generate().publicKey;
    const platformWallet = Keypair.generate().publicKey;
    const buf = Buffer.alloc(8 + 32 + 32); // discriminator + owner + platform_wallet (only fields we read)
    owner.toBuffer().copy(buf, 8);
    platformWallet.toBuffer().copy(buf, 40);

    const connection = {
      getAccountInfo: vi.fn(async () => ({ data: buf, executable: false, lamports: 0, owner: PublicKey.default, rentEpoch: 0 })),
    } as unknown as Connection;

    const result = await fetchPlatformWallet(connection, Keypair.generate().publicKey);
    expect(result?.toBase58()).toBe(platformWallet.toBase58());
  });

  it("returns null when the config account doesn't exist", async () => {
    const connection = {
      getAccountInfo: vi.fn(async () => null),
    } as unknown as Connection;

    const result = await fetchPlatformWallet(connection, Keypair.generate().publicKey);
    expect(result).toBeNull();
  });
});
