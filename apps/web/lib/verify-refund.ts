/**
 * Helpers that verify an on-chain ERC-20 transfer is a valid refund for a
 * given payment row. The API route fetches the receipt via viem;
 * `decodeTransferLogs` turns it into `Erc20TransferLog[]` and `verifyRefund`
 * interprets them.
 */

import { erc20Abi, parseEventLogs, type Log } from "viem";

export interface Erc20TransferLog {
  token: string;     // contract address of the token
  from: string;      // sender (merchant for a refund)
  to: string;        // recipient (original payer for a refund)
  value: bigint;     // transferred amount in token base units
}

/**
 * Decode the ERC-20 `Transfer(address,address,uint256)` events out of a
 * transaction receipt.
 *
 * This MUST go through viem's `parseEventLogs`, which matches `topics[0]`
 * against the event signature hash. The hand-rolled decoder this replaces
 * accepted any 3-topic log, so a USDC `Approval(owner,spender,value)` —
 * same contract, same topic count, no funds moved — satisfied refund
 * verification. Both refund routes call this so they cannot drift again.
 */
export function decodeTransferLogs(
  source: readonly Log[] | { logs: readonly Log[] },
): Erc20TransferLog[] {
  const logs = Array.isArray(source) ? source : (source as { logs: readonly Log[] }).logs;
  const parsed = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: logs as Log[],
    // Malformed/oversized logs are skipped rather than thrown on: a single
    // undecodable log must not make a legitimate refund unverifiable.
    strict: false,
  });

  const out: Erc20TransferLog[] = [];
  for (const log of parsed) {
    const { from, to, value } = log.args as {
      from?: string;
      to?: string;
      value?: bigint;
    };
    // `strict: false` can yield partially-decoded entries; drop them rather
    // than coercing undefined into a match.
    if (!from || !to || typeof value !== "bigint") continue;
    out.push({
      token: log.address.toLowerCase(),
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      value,
    });
  }
  return out;
}

export type VerifyRefundInput = {
  /** Parsed USDC Transfer events from the refund tx receipt. */
  transferLogs: Erc20TransferLog[];
  /** The payment this refund is against. */
  payment: {
    /** Original buyer wallet — refund recipient. */
    fromAddress: string;
    /** Original merchant wallet — refund sender. */
    toAddress: string;
    /** Cents already refunded; new refund + this must not exceed amount. */
    refundedCents: number;
    /** Total charged in cents. */
    amountCents: number;
  };
  /** Canonical token address for the payment's network (lowercased). */
  usdcAddress: string;
  /** Refund amount in cents the merchant is trying to record. */
  refundCents: number;
  /**
   * Token base units per cent. Derive it from the token's decimals via
   * `baseUnitsPerCent(decimals)` in `lib/amounts.ts` — never hardcode
   * `10_000n`, which is only correct for 6-decimal tokens.
   */
  baseUnitsPerCent: bigint;
};

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no_transfer"
        | "wrong_token"
        | "wrong_sender"
        | "wrong_recipient"
        | "insufficient_amount"
        | "over_refund"
        | "invalid_amount";
    };

export function verifyRefund(input: VerifyRefundInput): VerifyResult {
  const { payment, refundCents, usdcAddress, transferLogs, baseUnitsPerCent } =
    input;

  // Cents are always integers (CLAUDE.md invariant). Reject floats, NaN and
  // Infinity explicitly rather than letting BigInt() throw further down.
  if (!Number.isSafeInteger(refundCents) || refundCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  if (
    !Number.isSafeInteger(payment.refundedCents) ||
    payment.refundedCents < 0 ||
    !Number.isSafeInteger(payment.amountCents) ||
    payment.amountCents <= 0
  ) {
    return { ok: false, reason: "invalid_amount" };
  }
  if (baseUnitsPerCent <= 0n) {
    return { ok: false, reason: "invalid_amount" };
  }
  if (payment.refundedCents + refundCents > payment.amountCents) {
    return { ok: false, reason: "over_refund" };
  }

  const expectedBaseUnits = BigInt(refundCents) * baseUnitsPerCent;
  const expectedToken = usdcAddress.toLowerCase();
  const expectedFrom = payment.toAddress.toLowerCase();
  const expectedTo = payment.fromAddress.toLowerCase();

  // Find any transfer that matches token + direction; pick the first
  // with value >= expected. Merchants may send slightly more than the
  // exact refund (e.g. on-chain rounding), so >= is safer than ==.
  let sawToken = false;
  let sawDirection = false;
  let enough = false;
  for (const log of transferLogs) {
    const token = log.token.toLowerCase();
    if (token !== expectedToken) continue;
    sawToken = true;
    const from = log.from.toLowerCase();
    const to = log.to.toLowerCase();
    if (from !== expectedFrom || to !== expectedTo) continue;
    sawDirection = true;
    if (log.value >= expectedBaseUnits) {
      enough = true;
      break;
    }
  }

  if (transferLogs.length === 0) return { ok: false, reason: "no_transfer" };
  if (!sawToken) return { ok: false, reason: "wrong_token" };
  if (!sawDirection) {
    // Distinguish whether the sender or the recipient is wrong for a
    // clearer dashboard error. Cheaper than scanning twice.
    const senderMatchesSomewhere = transferLogs.some(
      (l) =>
        l.token.toLowerCase() === expectedToken &&
        l.from.toLowerCase() === expectedFrom,
    );
    return {
      ok: false,
      reason: senderMatchesSomewhere ? "wrong_recipient" : "wrong_sender",
    };
  }
  if (!enough) return { ok: false, reason: "insufficient_amount" };
  return { ok: true };
}
