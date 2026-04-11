// Contract addresses and ABIs for Paylix smart contracts on Base Sepolia

export const CONTRACTS = {
  paymentVault: (process.env.NEXT_PUBLIC_PAYMENT_VAULT_ADDRESS ||
    process.env.PAYMENT_VAULT_ADDRESS ||
    "0x2258933585eACca5fdB9748408C63B04E8af80f0") as `0x${string}`,
  subscriptionManager: (process.env.NEXT_PUBLIC_SUBSCRIPTION_MANAGER_ADDRESS ||
    process.env.SUBSCRIPTION_MANAGER_ADDRESS ||
    "0x99c04bc7944011e11BA384950AF91D1A375DC439") as `0x${string}`,
  usdc: (process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS ||
    process.env.MOCK_USDC_ADDRESS ||
    "0xcdb165A5adf89Cf71f3250e4b36132224fd5ab38") as `0x${string}`,
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
