// ABI definitions for Paylix smart contracts. Contract addresses are resolved
// per-request via resolveDeploymentForMode() in apps/web/lib/deployment.ts —
// nothing here depends on env vars or network config.

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
          { name: "permitValue", type: "uint256" },
          { name: "permitDeadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      { name: "subscriberAuthSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "getSubscriptionBackups",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "subscriptionId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
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
