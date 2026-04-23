import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";

export interface KeeperOptions {
  connection: Connection;
  /** Keeper signer keypair (loaded from SOLANA_KEEPER_KEYPAIR_PATH). */
  keeper?: Keypair;
  /** SubscriptionManager program ID. */
  subscriptionManagerProgramId?: PublicKey;
  /**
   * Source of subscriptions that are due. The orchestrator queries the
   * Postgres shared schema (network_key='solana') and pushes due IDs here.
   */
  dueSubscriptions?: () => Promise<SolanaDueSubscription[]>;
  /** Polling interval in ms (default 60s). */
  intervalMs?: number;
}

export interface SolanaDueSubscription {
  subscriptionPda: PublicKey;
  subscriptionId: bigint;
  subscriberAta: PublicKey;
  merchantAta: PublicKey;
  platformAta: PublicKey;
  mint: PublicKey;
}

export interface KeeperHandle {
  stop(): Promise<void>;
  /** Run one pass synchronously. Exposed for testing. */
  tick(): Promise<number>;
}

export async function startKeeper(opts: KeeperOptions): Promise<KeeperHandle> {
  const intervalMs = opts.intervalMs ?? 60_000;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<number> {
    if (stopped) return 0;
    if (!opts.keeper || !opts.subscriptionManagerProgramId || !opts.dueSubscriptions) {
      // Skeleton mode — no keeper keypair / no due-query hook. Useful for
      // booting the service in environments where the DB binding isn't
      // wired yet.
      return 0;
    }
    const due = await opts.dueSubscriptions();
    let charged = 0;
    for (const sub of due) {
      try {
        await chargeOne(opts.connection, opts.keeper, opts.subscriptionManagerProgramId, sub);
        charged++;
      } catch (err) {
        console.error(`[solana-keeper] charge for ${sub.subscriptionPda.toBase58()} failed:`, err);
      }
    }
    return charged;
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick().catch((err) => console.error("[solana-keeper] tick:", err));
      schedule();
    }, intervalMs);
  }

  schedule();
  console.log(`[solana-keeper] started (interval=${intervalMs}ms)`);

  return {
    tick,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// SPL Token program ID — classic Token program (not Token-2022). The Paylix
// Anchor programs use token_interface so either works at the CPI layer, but
// we pass the classic ID here because USDC / USDT / PYUSD on Solana are all
// classic-SPL-mints today. If the subscription's mint is a Token-2022 mint,
// the caller should compute the correct program id and pass it along via
// SolanaDueSubscription.
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

/**
 * Anchor computes instruction discriminators as the first 8 bytes of
 * sha256("global:<method_name>"). We derive at module init so a rename
 * in the Rust program surfaces as a tx-build mismatch instead of a silent
 * wrong-discriminator write.
 */
function chargeSubscriptionDiscriminator(): Buffer {
  const hash = sha256(new TextEncoder().encode("global:charge_subscription"));
  return Buffer.from(hash).subarray(0, 8);
}

const CHARGE_SUBSCRIPTION_DISC = chargeSubscriptionDiscriminator();

function configPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("sub_config")], programId);
  return pda;
}

/**
 * Build + submit the charge_subscription Anchor instruction. Hand-crafted
 * layout (no Anchor client dep) so the indexer stays lightweight.
 *
 * Accounts order must match the Rust program's #[derive(Accounts)] struct
 * exactly — see ChargeSubscription in paylix_subscription_manager/src/lib.rs.
 */
async function chargeOne(
  connection: Connection,
  keeper: Keypair,
  programId: PublicKey,
  sub: SolanaDueSubscription,
): Promise<void> {
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: sub.subscriptionPda, isSigner: false, isWritable: true },
      { pubkey: sub.mint, isSigner: false, isWritable: false },
      { pubkey: sub.subscriberAta, isSigner: false, isWritable: true },
      { pubkey: sub.merchantAta, isSigner: false, isWritable: true },
      { pubkey: sub.platformAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    // No extra args beyond the discriminator — charge_subscription takes
    // no parameters; everything comes from the subscription PDA's state.
    data: CHARGE_SUBSCRIPTION_DISC,
  });

  const { blockhash } = await connection.getLatestBlockhash("finalized");
  const msg = new TransactionMessage({
    payerKey: keeper.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  tx.sign([keeper]);
  await connection.sendTransaction(tx);
}
