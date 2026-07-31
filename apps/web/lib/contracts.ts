// ABI definitions for Paylix smart contracts. Contract addresses are resolved
// per-request via resolveDeploymentForMode() in apps/web/lib/deployment.ts —
// nothing here depends on env vars or network config.
//
// SOURCE OF TRUTH: packages/contracts/src/PaymentVault.sol,
// packages/contracts/src/SubscriptionManager.sol and the generated JSON in
// packages/contracts/abi/. Struct field ORDER is part of the ABI encoding and
// of every EIP-712 digest — a correct-looking tuple in the wrong order
// produces a signature the contract cannot verify. Re-check against
// `abi/*.json` after any contract change; do not hand-edit from memory.

/**
 * Settlement-flow identifiers bound into every signed intent (SC-23).
 *
 * `flow` is NOT a calldata field — each entry point passes its own constant
 * to `_consumePaymentIntent` / `_consumeSubscriptionIntent`. It IS part of the
 * EIP-712 typehash, so off-chain signers must include `uint8 flow` with the
 * matching value or the recovered signer will not match the buyer.
 *
 * Without it, a relayer holding an intent signed for the Permit2 flow could
 * settle it through the EIP-2612 or DAI flow against whatever residual
 * allowance the buyer happens to carry.
 *
 * PaymentVault: 1 | 2 | 3. SubscriptionManager: 1 | 2 only (no DAI path).
 */
export const FLOW_EIP2612 = 1 as const;
export const FLOW_PERMIT2 = 2 as const;
export const FLOW_DAI_PERMIT = 3 as const;

/**
 * On-chain `SubscriptionManager.Status`. Renumbered (SC-05/SC-21):
 * `None` MUST stay zero so an unwritten `subscriptions[id]` slot can never
 * pass an `== Active` check, and there is no `Expired` member — nothing ever
 * assigned it, and declaring it made off-chain decoders model an expiry
 * mechanism that does not exist.
 *
 * These are the CHAIN's values. They are deliberately distinct from the
 * `subscriptions.status` text column in Postgres ("active", "past_due",
 * "cancelled", "trialing") — do not index one with the other.
 */
export const ON_CHAIN_SUBSCRIPTION_STATUS = {
  None: 0,
  Active: 1,
  PastDue: 2,
  Cancelled: 3,
} as const;

export type OnChainSubscriptionStatus =
  (typeof ON_CHAIN_SUBSCRIPTION_STATUS)[keyof typeof ON_CHAIN_SUBSCRIPTION_STATUS];

/**
 * One deadline value for both the intent and the permit.
 *
 * `createPaymentWithPermit` enforces `d.deadline == permitSig.deadline`
 * ("Deadline mismatch"), and the subscription entry points gate the intent and
 * the permit on the same `p.deadline` / `permit2Permit.sigDeadline`. Because
 * the two now live in separate structs it is easy to derive them from two
 * separate `Date.now()` reads and land a one-second skew that reverts. Call
 * this once and pass the result to both.
 */
export function signatureDeadline(validForSeconds: number): bigint {
  if (!Number.isInteger(validForSeconds) || validForSeconds <= 0) {
    throw new Error(`Invalid signature validity window: ${validForSeconds}`);
  }
  return BigInt(Math.floor(Date.now() / 1000) + validForSeconds);
}

// ERC20 approve ABI
export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// PaymentVault.createPayment ABI
export const PAYMENT_VAULT_ABI = [
  {
    name: "createPayment",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "productId", type: "bytes32" },
      { name: "customerId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    // Now takes the signed intent as its own struct. NOTE the field order:
    // `buyer` precedes `token` in PaymentIntentData (it matches the EIP-712
    // typehash), the opposite of every other params struct in this file.
    // `d.deadline` MUST equal `permitSig.deadline` — see signatureDeadline().
    name: "createPaymentWithPermit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "d",
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "token", type: "address" },
          { name: "merchant", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "productId", type: "bytes32" },
          { name: "customerId", type: "bytes32" },
          { name: "maxFeeBps", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        name: "permitSig",
        type: "tuple",
        components: [
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      { name: "intentSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "createPaymentWithDaiPermit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "buyer", type: "address" },
          { name: "merchant", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "productId", type: "bytes32" },
          { name: "customerId", type: "bytes32" },
          // Fee ceiling the buyer signed. The owner can raise `platformFee` at
          // any time; binding the ceiling means an already-signed intent can
          // never settle at a worse rate (SC-03).
          { name: "maxFeeBps", type: "uint256" },
          { name: "daiNonce", type: "uint256" },
          { name: "permitExpiry", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
          { name: "intentSignature", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "createPaymentWithPermit2",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "buyer", type: "address" },
          { name: "merchant", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "productId", type: "bytes32" },
          { name: "customerId", type: "bytes32" },
          { name: "maxFeeBps", type: "uint256" },
          { name: "permit2Nonce", type: "uint256" },
          { name: "permit2Deadline", type: "uint256" },
          { name: "permit2Signature", type: "bytes" },
          { name: "intentSignature", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "getIntentNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "buyer", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// SubscriptionManager ABI (createSubscription + cancelSubscription)
export const SUBSCRIPTION_MANAGER_ABI = [
  {
    name: "createSubscription",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interval", type: "uint256" },
      { name: "productId", type: "bytes32" },
      { name: "customerId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "createSubscriptionWithPermit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "buyer", type: "address" },
          { name: "merchant", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "interval", type: "uint256" },
          { name: "productId", type: "bytes32" },
          { name: "customerId", type: "bytes32" },
          { name: "permitValue", type: "uint256" },
          // Fee ceiling the subscriber signed; stored per subscription and
          // clamped on every future charge, so an owner fee raise can never
          // reprice a live subscription (SC-03).
          { name: "maxFeeBps", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      { name: "intentSignature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "createSubscriptionWithPermitDiscount",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "buyer", type: "address" },
          { name: "merchant", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "interval", type: "uint256" },
          { name: "productId", type: "bytes32" },
          { name: "customerId", type: "bytes32" },
          { name: "permitValue", type: "uint256" },
          { name: "discountAmount", type: "uint256" },
          { name: "discountCycles", type: "uint256" },
          { name: "maxFeeBps", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      { name: "intentSignature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "createSubscriptionWithPermit2",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "buyer", type: "address" },
          { name: "merchant", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "interval", type: "uint256" },
          { name: "productId", type: "bytes32" },
          { name: "customerId", type: "bytes32" },
          { name: "maxFeeBps", type: "uint256" },
          // Must equal permit2Permit.sigDeadline so one value gates the intent
          // and the Permit2 signature. See signatureDeadline().
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        name: "permit2Permit",
        type: "tuple",
        components: [
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      { name: "permit2Signature", type: "bytes" },
      { name: "intentSignature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "subscriptionDiscounts",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "discountAmount", type: "uint256" },
      { name: "discountCyclesRemaining", type: "uint256" },
    ],
  },
  {
    // SC-01. A backup payer now needs the backup wallet's OWN EIP-712
    // BackupPayerConsent, not just an EIP-2612 permit — an ERC-20 allowance is
    // spending power, not agreement to bankroll subscription N. Previously the
    // permit was the only gate and it was swallowed by a try/catch, so any
    // address with a standing allowance could be attached without consent and
    // drained.
    //
    // `maxAmount` is the backup's own per-charge ceiling; it may sit below
    // `sub.amount`, in which case that wallet is skipped at charge time.
    name: "addSubscriptionBackupPayer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "subscriptionId", type: "uint256" },
          { name: "backup", type: "address" },
          { name: "authDeadline", type: "uint256" },
          { name: "maxAmount", type: "uint256" },
          { name: "consentDeadline", type: "uint256" },
          { name: "permitValue", type: "uint256" },
          { name: "permitDeadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      // Signed by the primary subscriber (BackupPayerAuth).
      { name: "subscriberAuthSig", type: "bytes" },
      // Signed by the backup wallet itself (BackupPayerConsent).
      { name: "backupConsentSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "subscriptionMaxFeeBps",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getSubscriptionBackups",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "subscriptionId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    // SubscriptionIntent / SubscriptionIntentDiscount nonces only.
    name: "getIntentNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "buyer", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // BackupPayerAuth nonces are a SEPARATE counter from getIntentNonce.
    // Signing a BackupPayerAuth with an intent nonce yields a digest the
    // contract cannot verify ("Bad subscriber auth").
    name: "getBackupAuthNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "subscriber", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // BackupPayerConsent nonces — a third, independent counter, keyed by the
    // backup wallet rather than the subscriber.
    name: "getBackupConsentNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "backup", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "cancelSubscription",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "subscriptionId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "cancelSubscriptionByRelayerForSubscriber",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subscriptionId", type: "uint256" },
      { name: "subscriber", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "cancelSubscriptionByRelayerForMerchant",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subscriptionId", type: "uint256" },
      { name: "merchant", type: "address" },
    ],
    outputs: [],
  },
] as const;

// ERC20Permit extension — for reading nonces and domain separator when
// building EIP-712 permit signatures client-side.
export const ERC20_PERMIT_ABI = [
  {
    name: "nonces",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "DOMAIN_SEPARATOR",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
