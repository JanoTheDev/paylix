// Contract addresses and ABIs for Paylix smart contracts. Reads the active
// network from apps/web/lib/chain.ts — no per-network branching lives here.
// Old hardcoded fallback addresses were removed to prevent an unconfigured
// deployment from silently talking to a stale Sepolia deployment.

import { USDC_ADDRESS } from "./chain";

function requireEnv(value: string | undefined, name: string): `0x${string}` {
  if (!value || value === "0x0000000000000000000000000000000000000000") {
    // During `next build`, Next compiles every route file and collects page
    // data even though no real requests are happening. CI builds without a
    // real .env, so throwing here would break builds. Fall back to the zero
    // address during build phase — route handlers read `CONTRACTS` on each
    // request and will naturally revert at runtime if the env wasn't set.
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return "0x0000000000000000000000000000000000000000" as `0x${string}`;
    }
    // Client-side: don't throw, the checkout page will render a config error
    // banner instead. Server-side runtime: loud 500 from any route that
    // reads CONTRACTS — the correct failure mode for an unconfigured prod.
    if (typeof window === "undefined") {
      throw new Error(`Missing required env var: ${name}`);
    }
    return "0x0000000000000000000000000000000000000000" as `0x${string}`;
  }
  return value as `0x${string}`;
}

export const CONTRACTS = {
  paymentVault: requireEnv(
    process.env.NEXT_PUBLIC_PAYMENT_VAULT_ADDRESS ||
      process.env.PAYMENT_VAULT_ADDRESS,
    "PAYMENT_VAULT_ADDRESS",
  ),
  subscriptionManager: requireEnv(
    process.env.NEXT_PUBLIC_SUBSCRIPTION_MANAGER_ADDRESS ||
      process.env.SUBSCRIPTION_MANAGER_ADDRESS,
    "SUBSCRIPTION_MANAGER_ADDRESS",
  ),
  // USDC comes from chain.ts: Circle's canonical address on mainnet, or the
  // merchant's MockUSDC deployment on testnet.
  usdc: (USDC_ADDRESS ||
    "0x0000000000000000000000000000000000000000") as `0x${string}`,
};

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
    name: "createPaymentWithPermit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "buyer", type: "address" },
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "productId", type: "bytes32" },
      { name: "customerId", type: "bytes32" },
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
    name: "getIntentNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "buyer", type: "address" }],
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
