/**
 * Fetches and decodes the on-chain Subscription account for the Solana
 * SubscriptionManager program. This is the only place merchant_ata and mint
 * are read for a due subscription — never re-derived off-chain, since
 * charge_subscription now rejects any merchant_ata that doesn't match this
 * exact on-chain value.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { BorshReader } from "./decoder";

export interface OnChainSubscription {
  id: bigint;
  subscriber: string;
  merchantAta: string;
  mint: string;
  amount: bigint;
  intervalSeconds: bigint;
  nextChargeAt: bigint;
  status: number; // 0 = Active, 1 = PastDue, 2 = Cancelled — see SubStatus in lib.rs
}

export function subscriptionPda(programId: PublicKey, onChainId: bigint): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(onChainId);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("sub"), idBuf], programId);
  return pda;
}

/** Fetch + Borsh-decode a Subscription account. Returns null if the account doesn't exist. */
export async function fetchSubscriptionAccount(
  connection: Connection,
  pda: PublicKey,
): Promise<OnChainSubscription | null> {
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;

  // 8-byte Anchor discriminator, then the Subscription struct fields in
  // declaration order (see `pub struct Subscription` in lib.rs):
  //   id: u64, subscriber: Pubkey, merchant_ata: Pubkey, mint: Pubkey,
  //   amount: u64, interval_seconds: i64, next_charge_at: i64,
  //   product_id: [u8;32], customer_id: [u8;32], total_charged: u64,
  //   status: u8, bump: u8
  const reader = new BorshReader(info.data.subarray(8));
  const id = reader.u64();
  const subscriber = reader.pubkey();
  const merchantAta = reader.pubkey();
  const mint = reader.pubkey();
  const amount = reader.u64();
  const intervalSeconds = reader.i64();
  const nextChargeAt = reader.i64();
  reader.bytes32(); // product_id — unused here
  reader.bytes32(); // customer_id — unused here
  reader.u64(); // total_charged — unused here
  const status = reader.u8();

  return { id, subscriber, merchantAta, mint, amount, intervalSeconds, nextChargeAt, status };
}

/**
 * Fetch + Borsh-decode just the `platform_wallet` field of the
 * SubscriptionManagerConfig account. This is the authority the Rust program
 * actually checks (`platform_ata.owner == config.platform_wallet`), so the
 * keeper reads it on-chain at startup rather than trusting an env var that
 * could drift from the deployed config. Returns null if the config account
 * doesn't exist (e.g. `initialize` was never called on this program).
 */
export async function fetchPlatformWallet(
  connection: Connection,
  configPda: PublicKey,
): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(configPda);
  if (!info) return null;

  // 8-byte Anchor discriminator, then: owner: Pubkey, platform_wallet: Pubkey, ...
  const reader = new BorshReader(info.data.subarray(8));
  reader.pubkey(); // owner — unused here
  const platformWallet = reader.pubkey();
  return new PublicKey(platformWallet);
}
