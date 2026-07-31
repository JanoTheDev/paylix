/**
 * ERC-20 `Transfer` decoding for the refund verification paths.
 *
 * Both refund routes used to hand-roll this and neither compared `topics[0]`
 * against the Transfer event hash, so USDC's `Approval(owner, spender,
 * value)` — also 3 topics, same contract, same data layout — satisfied
 * `verifyRefund`: a merchant could record a confirmed refund with a tx that
 * merely called `approve` and moved no funds.
 *
 * The signature-checked implementation lives next to `verifyRefund` itself.
 */

export { decodeTransferLogs } from "@/lib/verify-refund";
