import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  merchantPayoutWallets,
  users,
} from "@paylix/db/schema";
import type { NetworkKey } from "@paylix/config/networks";

/**
 * Resolves which wallet should receive payments for (userId, networkKey).
 *
 * Three-state precedence:
 *   1. No row or enabled=false  → throw (network not configured)
 *   2. Row with wallet_address  → return the override
 *   3. Row with NULL wallet_address → fall back to users.walletAddress
 *   4. Default also NULL/empty  → throw
 *
 * Called from the checkout-creation path so the merchant wallet is locked
 * at session-creation time, not resolved at payment time. This keeps the
 * contract args deterministic relative to the DB row.
 */
export async function resolvePayoutWallet(
  userId: string,
  networkKey: NetworkKey,
): Promise<`0x${string}`> {
  const row = await db.query.merchantPayoutWallets.findFirst({
    where: and(
      eq(merchantPayoutWallets.userId, userId),
      eq(merchantPayoutWallets.networkKey, networkKey),
      eq(merchantPayoutWallets.enabled, true),
    ),
  });

  if (!row) {
    throw new Error(
      `Network ${networkKey} is not enabled for this merchant`,
    );
  }

  if (row.walletAddress) {
    return row.walletAddress as `0x${string}`;
  }

  // Row exists and is enabled, but no override — use the default wallet.
  const [u] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId));

  if (!u?.walletAddress) {
    throw new Error(
      `No payout wallet configured for network ${networkKey}: ` +
        `the network uses the default wallet but users.walletAddress is empty`,
    );
  }

  return u.walletAddress as `0x${string}`;
}
