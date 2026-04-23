"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useChainId, useSwitchChain, usePublicClient, useSignTypedData } from "wagmi";
import { CheckCircle2, Clock } from "lucide-react";
import { keccak256, stringToBytes } from "viem";
import {
  ERC20_PERMIT_ABI,
  PAYMENT_VAULT_ABI,
  SUBSCRIPTION_MANAGER_ABI,
} from "@/lib/contracts";
import { NETWORKS, type TokenConfig } from "@paylix/config/networks";
import { QRCodeSVG } from "qrcode.react";
import { intervalToSeconds, formatInterval } from "@/lib/billing-intervals";
import { formatTrialDuration } from "@/lib/format-trial";
import { fromNativeUnits, formatNativeAmount } from "@/lib/amounts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { MonoText } from "@/components/mono-text";
import { UsdcBadge } from "@/components/usdc-badge";

type CheckoutStatus = "active" | "viewed" | "abandoned" | "completed" | "expired" | "awaiting_currency";

interface CheckoutSession {
  id: string;
  status: CheckoutStatus;
  amount: number | bigint;
  networkKey: string | null;
  tokenSymbol: string | null;
  type: string;
  merchantWallet: string;
  customerId: string | null;
  successUrl: string | null;
  cancelUrl: string | null;
  metadata: Record<string, string> | null;
  expiresAt: string | Date;
  productId: string;
  productName: string;
  productDescription: string | null;
  checkoutFields: {
    firstName?: boolean;
    lastName?: boolean;
    email?: boolean;
    phone?: boolean;
  } | null;
  collectCountry: boolean;
  collectTaxId: boolean;
  billingInterval: string | null;
  trialDays: number | null;
  trialMinutes: number | null;
  livemode: boolean;
  appliedCouponId?: string | null;
  discountCents?: number | null;
  subtotalAmount?: number | bigint | null;
  taxAmount?: number | bigint | null;
  taxRateBps?: number | null;
  taxLabel?: string | null;
  couponDuration?: "once" | "forever" | "repeating" | null;
  /** UTXO-chain receive address. Null on EVM/Solana sessions. */
  btcReceiveAddress?: string | null;
  couponDurationInCycles?: number | null;
}

interface CheckoutClientProps {
  session: CheckoutSession;
  availablePrices: Array<{
    networkKey: string;
    tokenSymbol: string;
    tokenName: string;
    displayLabel: string;
    amount: string;
    decimals: number;
  }>;
  chainId: number;
  paymentVaultAddress: `0x${string}`;
  subscriptionManagerAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}

export function CheckoutClient({ session, availablePrices, chainId, paymentVaultAddress, subscriptionManagerAddress, usdcAddress }: CheckoutClientProps) {
  const { open } = useAppKit();
  const { address: wagmiAddress, status: wagmiStatus } = useAccount();
  const { isConnected: appkitConnected, address: appkitAddress } =
    useAppKitAccount();
  const address = wagmiAddress ?? appkitAddress;
  const isConnected = appkitConnected;
  const [status, setStatus] = useState<CheckoutStatus>(session.status);
  // Resolve the active token's config (scheme, name, decimals) up front so
  // render-time hints can read it without duplicating the lookup in handlePay.
  const activeToken = useMemo(() => {
    if (!session.networkKey || !session.tokenSymbol) return null;
    const n = NETWORKS[session.networkKey as keyof typeof NETWORKS];
    if (!n) return null;
    return (n.tokens as Record<string, TokenConfig>)[session.tokenSymbol] ?? null;
  }, [session.networkKey, session.tokenSymbol]);

  // Chain-family classifier. UTXO chains (Bitcoin / Litecoin) show a QR code
  // + receive address instead of the EVM/Solana wallet-connect flow — buyers
  // on these chains send funds from whatever wallet they hold.
  const networkFamily = useMemo<"evm" | "utxo" | "solana">(() => {
    const k = session.networkKey;
    if (!k) return "evm";
    if (k === "bitcoin" || k === "bitcoin-testnet" || k === "litecoin" || k === "litecoin-testnet") return "utxo";
    if (k === "solana" || k === "solana-devnet") return "solana";
    return "evm";
  }, [session.networkKey]);
  const [customerFields, setCustomerFields] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    country: "",
    taxId: "",
  });
  const markedViewed = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [indexerOnline, setIndexerOnline] = useState<boolean>(true);
  const [customerUuid, setCustomerUuid] = useState<string | null>(null);
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const canUseCoupon = session.type === "one_time";

  async function handleApplyCoupon() {
    if (!couponInput.trim()) return;
    setApplyingCoupon(true);
    setCouponError(null);
    try {
      const res = await fetch(`/api/checkout/${session.id}/apply-coupon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim() }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        setCouponError(data.error?.message ?? "Could not apply this code");
      }
    } catch {
      setCouponError("Could not apply this code");
    } finally {
      setApplyingCoupon(false);
    }
  }

  async function handleRemoveCoupon() {
    setApplyingCoupon(true);
    try {
      await fetch(`/api/checkout/${session.id}/apply-coupon`, {
        method: "DELETE",
      });
      window.location.reload();
    } catch {
      setApplyingCoupon(false);
    }
  }

  // Check indexer status on mount and every 30s
  useEffect(() => {
    let cancelled = false;
    async function checkStatus() {
      try {
        const res = await fetch("/api/system/indexer-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIndexerOnline(Boolean(data.online));
      } catch {
        // ignore
      }
    }
    checkStatus();
    const id = setInterval(checkStatus, 30 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const hasCheckoutFields =
    (session.checkoutFields &&
      (session.checkoutFields.firstName ||
        session.checkoutFields.lastName ||
        session.checkoutFields.email ||
        session.checkoutFields.phone)) ||
    session.collectCountry ||
    session.collectTaxId;

  // Mark as viewed on mount
  useEffect(() => {
    if (markedViewed.current) return;
    markedViewed.current = true;

    fetch(`/api/checkout/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "viewed" }),
    }).catch(() => {});
  }, [session.id]);

  // Poll for status changes
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    setIsPolling(true);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/checkout/${session.id}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "completed") {
          setStatus("completed");
          if (data.customerUuid) setCustomerUuid(data.customerUuid);
          if (data.portalToken) setPortalToken(data.portalToken);
          stopPolling();
          // Redirect after 5s (give user time to see the portal link)
          if (session.successUrl) {
            setTimeout(() => {
              window.location.href = session.successUrl!;
            }, 5000);
          }
        } else if (data.status === "expired") {
          setStatus("expired");
          stopPolling();
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
  }, [session.id, session.successUrl, stopPolling]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  // Payment flow state
  const [payStep, setPayStep] = useState<"idle" | "approving" | "paying" | "confirming">("idle");
  const [payError, setPayError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  // Synchronous lock: React state updates are batched, so a double-click
  // can enter handlePay twice before payStep flips. The ref closes that gap.
  const payLockRef = useRef(false);

  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient({ chainId });
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [trialEligible, setTrialEligible] = useState<boolean | null>(null);
  const [trialIneligibleReason, setTrialIneligibleReason] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [fundingError, setFundingError] = useState<string | null>(null);

  const { data: usdcBalance } = useReadContract({
    address: usdcAddress,
    abi: [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ] as const,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });

  useEffect(() => {
    if (!address) {
      setTrialEligible(null);
      setTrialIneligibleReason(null);
      return;
    }
    const email = customerFields.email?.trim();
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ buyer: address });
        if (email) params.set("email", email);
        const res = await fetch(
          `/api/checkout/${session.id}/trial-eligibility?${params}`,
        );
        if (!res.ok) {
          if (!cancelled) setTrialEligible(null);
          return;
        }
        const data = (await res.json()) as {
          eligible: boolean;
          productHasTrial: boolean;
          reason?: string;
        };
        if (!cancelled) {
          setTrialEligible(data.eligible);
          setTrialIneligibleReason(data.reason ?? null);
        }
      } catch {
        if (!cancelled) setTrialEligible(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [address, session.id, customerFields.email]);
  const {
    isSuccess: txConfirmed,
    isError: txFailed,
    error: txError,
  } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId,
  });

  // Start polling when tx confirmed
  useEffect(() => {
    if (txConfirmed) {
      startPolling();
    }
  }, [txConfirmed, startPolling]);

  // Handle on-chain transaction failures (reverts, dropped, etc.)
  useEffect(() => {
    if (txFailed && txHash) {
      setPayError(txError?.message?.slice(0, 200) || "Transaction failed on-chain");
      setPayStep("idle");
      setTxHash(null);
      payLockRef.current = false;
    }
  }, [txFailed, txError, txHash]);

  // Abandonment tracking — only mark abandoned if NO payment has been initiated
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Skip if payment was initiated OR already completed/expired
      if (status !== "active" && status !== "viewed") return;
      if (txHash || payStep !== "idle") return;

      navigator.sendBeacon(
        `/api/checkout/${session.id}`,
        new Blob(
          [JSON.stringify({ status: "abandoned" })],
          { type: "application/json" }
        )
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [session.id, status, txHash, payStep]);

  const handlePay = async () => {
    if (payLockRef.current || payStep !== "idle") return; // prevent double clicks
    payLockRef.current = true;
    setPayError(null);

    if (wagmiStatus !== "connected" || !wagmiAddress) {
      open();
      payLockRef.current = false;
      return;
    }

    // Pre-flight: guard against double-payment by checking session status
    try {
      const res = await fetch(`/api/checkout/${session.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed") {
          setStatus("completed");
          if (data.customerUuid) setCustomerUuid(data.customerUuid);
          if (data.portalToken) setPortalToken(data.portalToken);
          payLockRef.current = false;
          return;
        }
        if (data.status === "expired") {
          setStatus("expired");
          payLockRef.current = false;
          return;
        }
      }
    } catch {
      // continue on network error
    }

    try {
      // Switch to target chain if not already on it
      if (walletChainId !== chainId) {
        setPayStep("approving");
        await switchChainAsync({ chainId });
      }

      // Persist the customer form BEFORE signing. The PATCH handler
      // recomputes tax when the country is set and may bump session.amount
      // (subtotal + tax). We read the fresh amount back so the permit
      // signs the tax-inclusive total.
      let effectiveAmount = BigInt(session.amount);
      if (hasCheckoutFields) {
        try {
          const patchRes = await fetch(`/api/checkout/${session.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customer: customerFields }),
          });
          if (patchRes.ok) {
            const patched = (await patchRes.json().catch(() => null)) as
              | { amount?: string | null }
              | null;
            if (patched?.amount) {
              effectiveAmount = BigInt(patched.amount);
            }
          }
        } catch {
          // ignore — fall back to prop amount
        }
      }
      const usdcAmount = effectiveAmount;

      const isSubscription = session.type === "subscription";
      const spender = isSubscription
        ? subscriptionManagerAddress
        : paymentVaultAddress;

      // Gasless flow: buyer signs an EIP-2612 permit (no gas, no transaction),
      // backend relayer submits createPaymentWithPermit/createSubscriptionWithPermit.
      // For subscriptions, permitValue is 1000x amount so the long-standing
      // allowance covers future keeper charges without re-prompting the user.
      const permitValue = isSubscription
        ? usdcAmount * BigInt(1000)
        : usdcAmount;

      // Deadline: 30 minutes from now. Long enough for the user to confirm,
      // short enough that stale signatures can't be replayed indefinitely.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);

      if (!publicClient) {
        throw new Error("Public client not available");
      }

      // Validate subscription interval up front so we don't ask the user to
      // sign a permit that the backend will just reject.
      if (isSubscription) {
        const intervalSeconds = intervalToSeconds(session.billingInterval);
        if (intervalSeconds <= 0) {
          throw new Error("Invalid billing interval for subscription");
        }
      }

      // Read EIP-712 domain version from the registry. We no longer call
      // contract.version() — the registry is authoritative.
      const activeNetwork = session.networkKey
        ? NETWORKS[session.networkKey as keyof typeof NETWORKS]
        : null;
      const activeToken = activeNetwork && session.tokenSymbol
        ? activeNetwork.tokens[session.tokenSymbol as keyof typeof activeNetwork.tokens]
        : null;
      if (!activeNetwork || !activeToken) {
        throw new Error("Session has no locked currency");
      }
      const tokenVersion = activeToken.eip712Version;
      const tokenName = activeToken.name;

      // ──────────────────────────────────────────────────────────────────
      // DAI-permit branch (Ethereum-mainnet DAI, one-time only)
      // ──────────────────────────────────────────────────────────────────
      // DAI uses a legacy permit shape:
      //   permit(holder, spender, nonce, expiry, allowed, v, r, s)
      // Signing `allowed=true` grants uint(-1) allowance. No separate amount
      // field — vault then pulls `amount` via safeTransferFrom.
      if (activeToken.signatureScheme === "dai-permit" && !isSubscription) {
        const tokenAddress = (activeToken.address ?? usdcAddress) as `0x${string}`;

        // DAI exposes a `nonces(address)` getter the same as EIP-2612 tokens.
        const daiNonce = (await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_PERMIT_ABI,
          functionName: "nonces",
          args: [address as `0x${string}`],
        })) as bigint;

        setPayStep("approving");
        const daiSignature = await signTypedDataAsync({
          domain: {
            name: tokenName as string,
            version: tokenVersion as string,
            chainId,
            verifyingContract: tokenAddress,
          },
          types: {
            Permit: [
              { name: "holder", type: "address" },
              { name: "spender", type: "address" },
              { name: "nonce", type: "uint256" },
              { name: "expiry", type: "uint256" },
              { name: "allowed", type: "bool" },
            ],
          },
          primaryType: "Permit",
          message: {
            holder: address as `0x${string}`,
            spender: paymentVaultAddress,
            nonce: daiNonce,
            expiry: deadline,
            allowed: true,
          },
        });

        // Split into v/r/s.
        const sigHexDai = daiSignature.slice(2);
        const rDai = `0x${sigHexDai.slice(0, 64)}` as `0x${string}`;
        const sDai = `0x${sigHexDai.slice(64, 128)}` as `0x${string}`;
        const rawVDai = parseInt(sigHexDai.slice(128, 130), 16);
        const vDai = rawVDai < 27 ? rawVDai + 27 : rawVDai;

        // Paylix PaymentIntent binding — identical shape to EIP-2612 path.
        const productIdBytesDai = keccak256(stringToBytes(session.productId));
        const customerIdBytesDai = keccak256(stringToBytes(session.id));
        const intentNonceDai = (await publicClient.readContract({
          address: paymentVaultAddress,
          abi: PAYMENT_VAULT_ABI,
          functionName: "getIntentNonce",
          args: [address as `0x${string}`],
        })) as bigint;

        const intentSigDai = await signTypedDataAsync({
          domain: {
            name: "Paylix PaymentVault",
            version: "1",
            chainId,
            verifyingContract: paymentVaultAddress,
          },
          types: {
            PaymentIntent: [
              { name: "buyer", type: "address" },
              { name: "token", type: "address" },
              { name: "merchant", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "productId", type: "bytes32" },
              { name: "customerId", type: "bytes32" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "PaymentIntent",
          message: {
            buyer: address as `0x${string}`,
            token: tokenAddress,
            merchant: session.merchantWallet as `0x${string}`,
            amount: usdcAmount,
            productId: productIdBytesDai,
            customerId: customerIdBytesDai,
            nonce: intentNonceDai,
            deadline,
          },
        });

        setPayStep("paying");
        const relayResDai = await fetch(`/api/checkout/${session.id}/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buyer: address,
            deadline: deadline.toString(),
            daiPermit: {
              nonce: daiNonce.toString(),
              v: vDai,
              r: rDai,
              s: sDai,
            },
            intentSignature: intentSigDai,
            networkKey: session.networkKey,
            tokenSymbol: session.tokenSymbol,
          }),
        });
        if (!relayResDai.ok) {
          const errBody = await relayResDai.json().catch(() => ({}));
          const errMsg =
            errBody?.error?.message ||
            errBody?.error?.code ||
            `Relay failed (${relayResDai.status})`;
          throw new Error(errMsg);
        }
        const relayBodyDai = (await relayResDai.json()) as { txHash?: `0x${string}` };
        if (relayBodyDai.txHash) setTxHash(relayBodyDai.txHash);
        setStatus("completed");
        return;
      }

      // ──────────────────────────────────────────────────────────────────
      // Permit2 SUBSCRIPTION branch (AllowanceTransfer)
      // ──────────────────────────────────────────────────────────────────
      // Buyer signs a PermitSingle granting SubscriptionManager an allowance
      // covering many cycles. Keeper pulls per cycle via Permit2.transferFrom.
      if (activeToken.signatureScheme === "permit2" && isSubscription) {
        const PERMIT2_ADDR = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
        const tokenAddress = (activeToken.address ?? usdcAddress) as `0x${string}`;

        // uint160 max = (1 << 160) - 1 ≈ 1.46e48. We ask for usdcAmount * 1000
        // which comfortably covers years of recurring charges for any
        // reasonable subscription amount.
        const allowanceAmount = usdcAmount * BigInt(1000);
        // Permit2 AllowanceTransfer expiration is uint48 (max ~year 8921000
        // AD). Set to 5 years from now.
        const expiration = Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 60 * 60;

        // Permit2 AllowanceTransfer nonces are uint48 per (owner, token, spender)
        // tuple. Starting from 0 is safe for first-time grants; a merchant
        // may want to increment on subsequent subscriptions. Read real
        // allowance state once issue #62's follow-up adds onchain nonce query.
        const allowanceNonce = 0;
        const sigDeadline = deadline;

        const intervalSecondsSub = BigInt(intervalToSeconds(session.billingInterval));

        setPayStep("approving");
        const permit2AllowanceSignature = await signTypedDataAsync({
          domain: {
            name: "Permit2",
            chainId,
            verifyingContract: PERMIT2_ADDR,
          },
          types: {
            PermitSingle: [
              { name: "details", type: "PermitDetails" },
              { name: "spender", type: "address" },
              { name: "sigDeadline", type: "uint256" },
            ],
            PermitDetails: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
          primaryType: "PermitSingle",
          message: {
            details: {
              token: tokenAddress,
              amount: allowanceAmount,
              expiration,
              nonce: allowanceNonce,
            },
            spender: subscriptionManagerAddress,
            sigDeadline,
          },
        });

        // Paylix SubscriptionIntent binding. Reuses the SubscriptionIntent
        // typehash used by the EIP-2612 path; permitValue = allowance amount
        // so the buyer still commits to a concrete upper bound in the intent.
        const productIdBytes = keccak256(stringToBytes(session.productId));
        const customerIdBytes = keccak256(stringToBytes(session.id));
        const intentNonceSub = (await publicClient.readContract({
          address: subscriptionManagerAddress,
          abi: SUBSCRIPTION_MANAGER_ABI,
          functionName: "getIntentNonce",
          args: [address as `0x${string}`],
        })) as bigint;

        const intentSignatureSub = await signTypedDataAsync({
          domain: {
            name: "Paylix SubscriptionManager",
            version: "1",
            chainId,
            verifyingContract: subscriptionManagerAddress,
          },
          types: {
            SubscriptionIntent: [
              { name: "buyer", type: "address" },
              { name: "token", type: "address" },
              { name: "merchant", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "interval", type: "uint256" },
              { name: "productId", type: "bytes32" },
              { name: "customerId", type: "bytes32" },
              { name: "permitValue", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "SubscriptionIntent",
          message: {
            buyer: address as `0x${string}`,
            token: tokenAddress,
            merchant: session.merchantWallet as `0x${string}`,
            amount: usdcAmount,
            interval: intervalSecondsSub,
            productId: productIdBytes,
            customerId: customerIdBytes,
            permitValue: allowanceAmount,
            nonce: intentNonceSub,
            deadline,
          },
        });

        setPayStep("paying");
        const relayResSub = await fetch(`/api/checkout/${session.id}/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buyer: address,
            deadline: deadline.toString(),
            permit2Allowance: {
              amount: allowanceAmount.toString(),
              expiration,
              nonce: allowanceNonce,
              sigDeadline: sigDeadline.toString(),
            },
            permit2AllowanceSignature,
            intentSignature: intentSignatureSub,
            networkKey: session.networkKey,
            tokenSymbol: session.tokenSymbol,
          }),
        });
        if (!relayResSub.ok) {
          const errBody = await relayResSub.json().catch(() => ({}));
          const errMsg =
            errBody?.error?.message ||
            errBody?.error?.code ||
            `Relay failed (${relayResSub.status})`;
          throw new Error(errMsg);
        }
        const relayBodySub = (await relayResSub.json()) as { txHash?: `0x${string}` };
        if (relayBodySub.txHash) setTxHash(relayBodySub.txHash);
        setStatus("completed");
        return;
      }

      // ──────────────────────────────────────────────────────────────────
      // Permit2 ONE-TIME branch (SignatureTransfer)
      // ──────────────────────────────────────────────────────────────────
      // Tokens without native EIP-2612 are routed through Uniswap's Permit2
      // singleton at 0x000000000022D473030F116dDEE9F6B43aC78BA3 (same address
      // on every EVM chain). The buyer signs a PermitTransferFrom authorizing
      // a one-shot pull; the vault's createPaymentWithPermit2 CPIs Permit2.
      if (activeToken.signatureScheme === "permit2" && !isSubscription) {
        const PERMIT2_ADDR = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

        // Resolve the actual token address (USDT, WETH, etc.) — not the
        // chain's USDC. For mainnet entries this is the canonical address
        // baked into the registry.
        const tokenAddress = (activeToken.address ?? usdcAddress) as `0x${string}`;

        // Permit2 uses a random uint256 nonce (bitmap-indexed). Generate
        // one client-side — Permit2 itself enforces uniqueness.
        const nonceBytes = new Uint8Array(32);
        crypto.getRandomValues(nonceBytes);
        const permit2Nonce = BigInt(
          "0x" + Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, "0")).join(""),
        );

        setPayStep("approving");

        const permit2Signature = await signTypedDataAsync({
          domain: {
            name: "Permit2",
            chainId,
            verifyingContract: PERMIT2_ADDR,
          },
          types: {
            PermitTransferFrom: [
              { name: "permitted", type: "TokenPermissions" },
              { name: "spender", type: "address" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
            TokenPermissions: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          primaryType: "PermitTransferFrom",
          message: {
            permitted: {
              token: tokenAddress,
              amount: usdcAmount,
            },
            spender: paymentVaultAddress,
            nonce: permit2Nonce,
            deadline,
          },
        });

        // Paylix PaymentIntent binding — same shape as the EIP-2612 path so
        // the vault's _consumePaymentIntent recovers the same digest.
        const productIdBytesP2 = keccak256(stringToBytes(session.productId));
        const customerIdBytesP2 = keccak256(stringToBytes(session.id));
        const intentNonceP2 = (await publicClient.readContract({
          address: paymentVaultAddress,
          abi: PAYMENT_VAULT_ABI,
          functionName: "getIntentNonce",
          args: [address as `0x${string}`],
        })) as bigint;

        const intentSigP2 = await signTypedDataAsync({
          domain: {
            name: "Paylix PaymentVault",
            version: "1",
            chainId,
            verifyingContract: paymentVaultAddress,
          },
          types: {
            PaymentIntent: [
              { name: "buyer", type: "address" },
              { name: "token", type: "address" },
              { name: "merchant", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "productId", type: "bytes32" },
              { name: "customerId", type: "bytes32" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "PaymentIntent",
          message: {
            buyer: address as `0x${string}`,
            token: tokenAddress,
            merchant: session.merchantWallet as `0x${string}`,
            amount: usdcAmount,
            productId: productIdBytesP2,
            customerId: customerIdBytesP2,
            nonce: intentNonceP2,
            deadline,
          },
        });

        setPayStep("paying");

        const relayResP2 = await fetch(`/api/checkout/${session.id}/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buyer: address,
            deadline: deadline.toString(),
            permit2Nonce: permit2Nonce.toString(),
            permit2Signature,
            intentSignature: intentSigP2,
            networkKey: session.networkKey,
            tokenSymbol: session.tokenSymbol,
          }),
        });

        if (!relayResP2.ok) {
          const errBody = await relayResP2.json().catch(() => ({}));
          const errMsg =
            errBody?.error?.message ||
            errBody?.error?.code ||
            `Relay failed (${relayResP2.status})`;
          throw new Error(errMsg);
        }
        const relayBodyP2 = (await relayResP2.json()) as {
          txHash?: `0x${string}`;
        };
        if (relayBodyP2.txHash) setTxHash(relayBodyP2.txHash);
        setStatus("completed");
        return;
      }
      // ──────────────────────────────────────────────────────────────────
      // EIP-2612 branch (USDC / PYUSD / subscriptions today)
      // ──────────────────────────────────────────────────────────────────

      // Fetch the current on-chain permit nonce
      const [nonce] = await Promise.all([
        publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_PERMIT_ABI,
          functionName: "nonces",
          args: [address as `0x${string}`],
        }),
      ]);

      setPayStep("approving"); // reuse "approving" step for the signing prompt

      const signature = await signTypedDataAsync({
        domain: {
          name: tokenName as string,
          version: tokenVersion as string,
          chainId,
          verifyingContract: usdcAddress,
        },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: {
          owner: address as `0x${string}`,
          spender: spender as `0x${string}`,
          value: permitValue,
          nonce: nonce as bigint,
          deadline,
        },
      });

      // Split the 65-byte signature into v, r, s
      const sigHex = signature.slice(2); // strip 0x
      const r = `0x${sigHex.slice(0, 64)}` as `0x${string}`;
      const s = `0x${sigHex.slice(64, 128)}` as `0x${string}`;
      const rawV = parseInt(sigHex.slice(128, 130), 16);
      // Normalize: some wallets return v as 0/1 (EIP-155), ecrecover expects 27/28.
      const v = rawV < 27 ? rawV + 27 : rawV;

      // ---- PaymentIntent / SubscriptionIntent EIP-712 signature ----
      // The permit only authorizes the spender contract to pull `permitValue`
      // from the buyer. It does NOT commit to a specific merchant. To prevent
      // a compromised relayer from redirecting funds, the buyer also signs an
      // EIP-712 PaymentIntent that binds merchant + amount + productId +
      // customerId + nonce + deadline. The contract recovers this signature
      // and reverts on mismatch.
      //
      // productId/customerId hashes MUST match what the server passes to the
      // contract — see apps/web/app/api/checkout/[id]/relay/route.ts.
      const productIdBytes = keccak256(stringToBytes(session.productId));
      const customerIdBytes = keccak256(stringToBytes(session.id));

      const intentNonce = (await publicClient.readContract({
        address: spender as `0x${string}`,
        abi: isSubscription ? SUBSCRIPTION_MANAGER_ABI : PAYMENT_VAULT_ABI,
        functionName: "getIntentNonce",
        args: [address as `0x${string}`],
      })) as bigint;

      let intentSignature: string;
      if (isSubscription) {
        const intervalSeconds = BigInt(intervalToSeconds(session.billingInterval));
        // Subscription + once/repeating coupon: sign the extended
        // SubscriptionIntentDiscount typed data so the on-chain contract
        // commits to the per-cycle discount + cycle count.
        const isDiscountSub =
          session.appliedCouponId &&
          session.couponDuration &&
          session.couponDuration !== "forever" &&
          session.discountCents != null;
        if (isDiscountSub) {
          const discountAmount = BigInt(session.discountCents!);
          const discountCycles = BigInt(
            session.couponDuration === "once"
              ? 1
              : session.couponDurationInCycles ?? 1,
          );
          intentSignature = await signTypedDataAsync({
            domain: {
              name: "Paylix SubscriptionManager",
              version: "1",
              chainId,
              verifyingContract: spender as `0x${string}`,
            },
            types: {
              SubscriptionIntentDiscount: [
                { name: "buyer", type: "address" },
                { name: "token", type: "address" },
                { name: "merchant", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "interval", type: "uint256" },
                { name: "productId", type: "bytes32" },
                { name: "customerId", type: "bytes32" },
                { name: "permitValue", type: "uint256" },
                { name: "discountAmount", type: "uint256" },
                { name: "discountCycles", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
              ],
            },
            primaryType: "SubscriptionIntentDiscount",
            message: {
              buyer: address as `0x${string}`,
              token: usdcAddress,
              merchant: session.merchantWallet as `0x${string}`,
              amount: usdcAmount,
              interval: intervalSeconds,
              productId: productIdBytes,
              customerId: customerIdBytes,
              permitValue,
              discountAmount,
              discountCycles,
              nonce: intentNonce,
              deadline,
            },
          });
        } else {
          intentSignature = await signTypedDataAsync({
            domain: {
              name: "Paylix SubscriptionManager",
              version: "1",
              chainId,
              verifyingContract: spender as `0x${string}`,
            },
            types: {
              SubscriptionIntent: [
                { name: "buyer", type: "address" },
                { name: "token", type: "address" },
                { name: "merchant", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "interval", type: "uint256" },
                { name: "productId", type: "bytes32" },
                { name: "customerId", type: "bytes32" },
                { name: "permitValue", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
              ],
            },
            primaryType: "SubscriptionIntent",
            message: {
              buyer: address as `0x${string}`,
              token: usdcAddress,
              merchant: session.merchantWallet as `0x${string}`,
              amount: usdcAmount,
              interval: intervalSeconds,
              productId: productIdBytes,
              customerId: customerIdBytes,
              permitValue,
              nonce: intentNonce,
              deadline,
            },
          });
        }
      } else {
        intentSignature = await signTypedDataAsync({
          domain: {
            name: "Paylix PaymentVault",
            version: "1",
            chainId,
            verifyingContract: spender as `0x${string}`,
          },
          types: {
            PaymentIntent: [
              { name: "buyer", type: "address" },
              { name: "token", type: "address" },
              { name: "merchant", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "productId", type: "bytes32" },
              { name: "customerId", type: "bytes32" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "PaymentIntent",
          message: {
            buyer: address as `0x${string}`,
            token: usdcAddress,
            merchant: session.merchantWallet as `0x${string}`,
            amount: usdcAmount,
            productId: productIdBytes,
            customerId: customerIdBytes,
            nonce: intentNonce,
            deadline,
          },
        });
      }

      setPayStep("paying");

      // Submit to the backend relay endpoint — it will call the contract
      // via the whitelisted relayer wallet and return the tx hash.
      const relayRes = await fetch(`/api/checkout/${session.id}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer: address,
          deadline: deadline.toString(),
          permitValue: permitValue.toString(),
          v,
          r,
          s,
          intentSignature,
          networkKey: session.networkKey,
          tokenSymbol: session.tokenSymbol,
        }),
      });

      if (!relayRes.ok) {
        const errBody = await relayRes.json().catch(() => ({}));
        const errMsg =
          errBody?.error?.message ||
          errBody?.error?.code ||
          `Relay failed (${relayRes.status})`;
        throw new Error(errMsg);
      }

      const relayBody = (await relayRes.json()) as {
        txHash?: `0x${string}`;
        trial?: boolean;
        subscriptionId?: string;
        trialEndsAt?: string;
        customerUuid?: string;
        portalToken?: string;
      };

      if (relayBody.trial) {
        if (relayBody.customerUuid) setCustomerUuid(relayBody.customerUuid);
        if (relayBody.portalToken) setPortalToken(relayBody.portalToken);
        setStatus("completed");
        setPayStep("idle");
        payLockRef.current = false;
        if (session.successUrl) {
          setTimeout(() => {
            window.location.href = session.successUrl!;
          }, 1500);
        }
        return;
      }

      if (!relayBody.txHash) {
        throw new Error("Relay returned no txHash");
      }
      setTxHash(relayBody.txHash);
      setPayStep("confirming");
    } catch (err) {
      console.error("Payment failed:", err);
      const msg = err instanceof Error ? err.message : "Payment failed";
      setPayError(msg.slice(0, 200));
      setPayStep("idle");
      payLockRef.current = false;
    }
  };

  // session.amount is now native token units directly (bigint). Convert to
  // human-readable for display and payment call.
  const requiredTokenAmount = BigInt(session.amount);
  const tokenDecimals = (() => {
    if (!session.networkKey || !session.tokenSymbol) return 6;
    const network = NETWORKS[session.networkKey as keyof typeof NETWORKS];
    if (!network) return 6;
    const token = network.tokens[session.tokenSymbol as keyof typeof network.tokens];
    return token?.decimals ?? 6;
  })();
  const displayAmount = fromNativeUnits(requiredTokenAmount, tokenDecimals);

  const isInsufficient =
    usdcBalance !== undefined
      ? usdcBalance < requiredTokenAmount
      : false;

  const trialDuration = formatTrialDuration(session.trialDays, session.trialMinutes);
  const productHasTrial = trialDuration !== null && session.type === "subscription";
  const isTrial = productHasTrial && trialEligible !== false;

  async function handleFundWallet() {
    if (!address) return;
    setFunding(true);
    setFundingError(null);
    try {
      const res = await fetch(`/api/checkout/${session.id}/fund-wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          data?.error?.message ?? data?.error ?? "Failed to fund wallet";
        setFundingError(typeof msg === "string" ? msg : "Failed to fund wallet");
        return;
      }
      await new Promise((r) => setTimeout(r, 2500));
      window.location.reload();
    } catch (err) {
      setFundingError(err instanceof Error ? err.message : "Failed to fund wallet");
    } finally {
      setFunding(false);
    }
  }

  async function handlePickCurrency(
    networkKey: string,
    tokenSymbol: string,
  ) {
    setIsPicking(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/checkout/${session.id}/pick-currency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ networkKey, tokenSymbol }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPayError(
          typeof body.error === "string"
            ? body.error
            : body.error?.message ?? "Failed to pick currency",
        );
        return;
      }
      // Server returns updated session — refresh the page to pick up the new state
      window.location.reload();
    } finally {
      setIsPicking(false);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Solana render branch
  // ──────────────────────────────────────────────────────────────────
  // Full @solana/wallet-adapter-react integration lands in a follow-up;
  // until then show a clear "use your Solana wallet directly" screen so
  // buyers aren't stuck staring at a broken EVM wallet-connect modal.
  if (networkFamily === "solana" && status !== "completed") {
    const decimals = activeToken?.decimals ?? 6;
    const amountStr = formatNativeAmount(
      BigInt(session.amount),
      decimals,
      session.tokenSymbol ?? "USDC",
    );
    const merchantTruncated = `${session.merchantWallet.slice(0, 8)}…${session.merchantWallet.slice(-4)}`;

    return (
      <Card className="w-full max-w-[520px] p-8 shadow-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-[-0.4px]">
            {session.productName}
          </h1>
          {session.productDescription && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {session.productDescription}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface-1 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Pay on Solana</span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Beta
            </span>
          </div>
          <div className="mb-3">
            <div className="text-[11px] text-muted-foreground">Amount</div>
            <MonoText className="text-lg font-semibold tabular-nums">
              {amountStr}
            </MonoText>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Merchant</div>
            <MonoText className="text-xs break-all">
              {session.merchantWallet}
            </MonoText>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-background p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground mb-2">How to pay</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Open Phantom, Backpack, or Solflare on the same device.</li>
            <li>
              Send <MonoText>{amountStr}</MonoText> to{" "}
              <MonoText>{merchantTruncated}</MonoText>.
            </li>
            <li>
              Keep this tab open. Paylix picks up the on-chain event and
              updates this page automatically.
            </li>
          </ol>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          In-page wallet connect is in beta. Hosted Phantom / Backpack flow
          tracked as a follow-up.
        </p>

        <div className="mt-6 text-center">
          <span className="text-xs tracking-[0.2px] text-muted-foreground">
            Powered by Paylix
          </span>
        </div>
      </Card>
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Bitcoin / Litecoin render branch
  // ──────────────────────────────────────────────────────────────────
  // UTXO chains have no wallet-connect flow — buyer sends funds from their
  // own wallet to the merchant's per-session BIP32-derived address. We
  // show the address + QR + confirmation poll, then flip to `completed`
  // once the watcher marks it paid.
  if (networkFamily === "utxo" && status !== "completed") {
    const coinLabel = session.networkKey?.startsWith("bitcoin") ? "BTC" : "LTC";
    const decimals = activeToken?.decimals ?? 8;
    const amountStr = formatNativeAmount(BigInt(session.amount), decimals, coinLabel);

    if (!session.btcReceiveAddress) {
      return (
        <Card className="w-full max-w-[480px] p-8 shadow-2xl">
          <h1 className="text-xl font-semibold tracking-[-0.4px]">
            {session.productName}
          </h1>
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>
              No receive address has been derived for this session yet.
              Either the merchant hasn&apos;t configured their {coinLabel} xpub
              yet, or the UTXO indexer isn&apos;t running. Contact the merchant.
            </AlertDescription>
          </Alert>
        </Card>
      );
    }

    return (
      <Card className="w-full max-w-[520px] p-8 shadow-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-[-0.4px]">
            {session.productName}
          </h1>
          {session.productDescription && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {session.productDescription}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface-1 p-6">
          <QRCodeSVG
            value={`${session.networkKey?.startsWith("bitcoin") ? "bitcoin" : "litecoin"}:${session.btcReceiveAddress}?amount=${amountStr.replace(/[^\d.]/g, "")}`}
            size={220}
            bgColor="transparent"
            fgColor="currentColor"
            level="M"
          />
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground mb-1">
              Send exactly
            </div>
            <MonoText className="text-lg font-semibold tabular-nums">
              {amountStr}
            </MonoText>
          </div>
          <div className="w-full">
            <div className="text-[11px] text-muted-foreground mb-1 text-center">
              To this address
            </div>
            <div className="break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] text-center">
              {session.btcReceiveAddress}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={() => {
                void navigator.clipboard.writeText(session.btcReceiveAddress!);
              }}
            >
              Copy address
            </Button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Waiting for confirmation. {coinLabel} payments typically confirm in{" "}
          {coinLabel === "BTC" ? "10–20 minutes" : "5–15 minutes"}. Keep this
          tab open — the page updates automatically.
        </p>

        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Do not send a different amount. Send the exact {amountStr}, or the
          payment won&apos;t match.
        </p>

        <div className="mt-6 text-center">
          <span className="text-xs tracking-[0.2px] text-muted-foreground">
            Powered by Paylix
          </span>
        </div>
      </Card>
    );
  }

  if (status === "awaiting_currency") {
    // Group prices by network so the picker is "pick a blockchain, then pick
    // a coin on it" — mirrors how buyers think rather than dumping every
    // combination as a flat list.
    const groups = new Map<
      string,
      {
        networkKey: string;
        displayLabel: string;
        items: typeof availablePrices;
      }
    >();
    for (const p of availablePrices) {
      const g = groups.get(p.networkKey);
      if (g) g.items.push(p);
      else
        groups.set(p.networkKey, {
          networkKey: p.networkKey,
          displayLabel: p.displayLabel,
          items: [p],
        });
    }

    return (
      <Card className="w-full max-w-[520px] p-8 shadow-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-[-0.4px]">
            {session.productName}
          </h1>
          {session.productDescription && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {session.productDescription}
            </p>
          )}
        </div>

        <h3 className="mb-1 text-sm font-medium">Pick a network and coin</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Pay on the blockchain and with the coin you already hold. The amount
          is identical either way — pick what&apos;s cheapest to move.
        </p>

        <div className="flex flex-col gap-4">
          {Array.from(groups.values()).map((g) => (
            <div
              key={g.networkKey}
              className="rounded-xl border border-border bg-surface-1 p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium">{g.displayLabel}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  {g.networkKey.includes("sepolia") ||
                  g.networkKey.includes("amoy") ||
                  g.networkKey.includes("fuji") ||
                  g.networkKey.includes("testnet")
                    ? "Testnet"
                    : "Mainnet"}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {g.items.map((p) => (
                  <button
                    key={`${p.networkKey}:${p.tokenSymbol}`}
                    onClick={() =>
                      handlePickCurrency(p.networkKey, p.tokenSymbol)
                    }
                    disabled={isPicking}
                    className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                  >
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{p.tokenSymbol}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.tokenName}
                      </span>
                    </div>
                    <MonoText className="tabular-nums font-medium">
                      {formatNativeAmount(
                        BigInt(p.amount),
                        p.decimals,
                        p.tokenSymbol,
                      )}
                    </MonoText>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {availablePrices.length === 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                This product has no active prices. Contact the merchant.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {payError && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription className="text-xs">{payError}</AlertDescription>
          </Alert>
        )}

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          New to crypto? A wallet like MetaMask or Rabby lets you hold and
          send coins. You&apos;ll pick yours on the next screen after you choose.
        </p>

        <div className="mt-2 text-center">
          <span className="text-xs tracking-[0.2px] text-muted-foreground">
            Powered by Paylix
          </span>
        </div>
      </Card>
    );
  }

  if (status === "completed") {
    const isSubscription = session.type === "subscription";
    return (
      <Card className="w-full max-w-[480px] p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[color:var(--success)]/30 bg-[color:var(--success)]/10">
            <CheckCircle2 size={32} className="text-[color:var(--success)]" />
          </div>
          <h2 className="mb-2 text-xl font-semibold tracking-[-0.4px]">
            {isTrial
              ? "Trial started!"
              : isSubscription
              ? "Subscription active!"
              : "Payment confirmed!"}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {isTrial
              ? `You won't be charged until your trial ends. First charge of $${displayAmount} ${session.tokenSymbol ?? ""} ${formatInterval(session.billingInterval)}.`
              : isSubscription
              ? `You'll be charged $${displayAmount} ${formatInterval(session.billingInterval)}. First charge completed.`
              : `$${displayAmount} ${session.tokenSymbol ?? ""} received successfully.`}
          </p>

          {customerUuid && portalToken && (
            <Button variant="outline" className="mt-6" asChild>
              <a href={`/portal/${customerUuid}?token=${portalToken}`}>
                {isSubscription ? "Manage subscription" : "View purchase history"}
              </a>
            </Button>
          )}

          {session.successUrl && (
            <p className="mt-4 text-xs text-muted-foreground">
              Redirecting you back in a few seconds...
            </p>
          )}
        </div>

        <div className="text-center">
          <span className="text-xs tracking-[0.2px] text-muted-foreground">
            Powered by Paylix
          </span>
        </div>
      </Card>
    );
  }

  if (status === "expired") {
    return (
      <Card className="w-full max-w-[480px] p-8 text-center shadow-2xl">
        <div className="mb-3 flex justify-center text-[color:var(--warning)]">
          <Clock size={40} />
        </div>
        <h1 className="mb-2 text-xl font-semibold tracking-[-0.4px]">
          This checkout has expired
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This payment session is no longer active. Please request a new
          checkout link.
        </p>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-[720px] shadow-2xl overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* Left: Product Info */}
        <div className="p-8 lg:border-r lg:border-border">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-[-0.4px]">
              {session.productName}
            </h1>
            {session.type === "subscription" && (
              isTrial ? (
                <span className="inline-flex items-center rounded-sm bg-info/10 px-2 py-0.5 text-xs font-medium text-info ring-1 ring-inset ring-info/20">
                  Free trial
                </span>
              ) : (
                <Badge variant="default">Subscription</Badge>
              )
            )}
          </div>

          {session.productDescription && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {session.productDescription}
            </p>
          )}

          <div className="mt-6">
            <div className="flex items-baseline gap-2">
              <MonoText className="text-3xl font-semibold tracking-[-0.3px]">
                ${displayAmount}
              </MonoText>
              <UsdcBadge symbol={session.tokenSymbol ?? "USDC"} />
            </div>
            {session.type === "subscription" && (
              <p className="mt-1 text-sm text-muted-foreground">
                {formatInterval(session.billingInterval)}
              </p>
            )}
          </div>

          {session.type === "subscription" && (
            <div className="mt-4">
              <p className="text-[13px] leading-snug text-muted-foreground">
                {isTrial ? (
                  <>
                    Free for{" "}
                    <span className="font-mono text-foreground">{trialDuration}</span>
                    , then{" "}
                    <span className="font-medium text-foreground">
                      ${displayAmount} {session.tokenSymbol ?? "USDC"}
                    </span>{" "}
                    {formatInterval(session.billingInterval)}.
                  </>
                ) : (
                  <>
                    Charged{" "}
                    <span className="font-medium text-foreground">
                      ${displayAmount} {session.tokenSymbol ?? "USDC"}
                    </span>{" "}
                    {formatInterval(session.billingInterval)} until cancelled.
                  </>
                )}
              </p>
            </div>
          )}

          {productHasTrial && trialEligible === false && (
            <p className="mt-3 text-[12px] italic text-muted-foreground">
              {trialIneligibleReason === "wallet_inactive"
                ? "Free trials require a wallet with on-chain activity."
                : "You've already used the free trial for this product."}
            </p>
          )}

          {session.metadata && Object.keys(session.metadata).length > 0 && (
            <div className="mt-6 space-y-1.5">
              {Object.entries(session.metadata).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-mono text-foreground">{v}</span>
                </div>
              ))}
            </div>
          )}

          {!indexerOnline && (
            <Alert variant="default" className="mt-6 border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10">
              <AlertTitle className="text-[color:var(--warning)]">
                Payment processing unavailable
              </AlertTitle>
              <AlertDescription>
                Our payment system is temporarily down. Please try again in a few
                minutes.
              </AlertDescription>
            </Alert>
          )}

        </div>

        {/* Right: Action area */}
        <div className="flex flex-col justify-between p-8">
          <div className="flex flex-col gap-4">
            {hasCheckoutFields && (
              <div className="flex flex-col gap-3">
                {session.checkoutFields?.firstName && (
                  <div className="space-y-1.5">
                    <Label>First Name</Label>
                    <Input
                      type="text"
                      value={customerFields.firstName}
                      onChange={(e) =>
                        setCustomerFields((f) => ({
                          ...f,
                          firstName: e.target.value,
                        }))
                      }
                      placeholder="John"
                    />
                  </div>
                )}
                {session.checkoutFields?.lastName && (
                  <div className="space-y-1.5">
                    <Label>Last Name</Label>
                    <Input
                      type="text"
                      value={customerFields.lastName}
                      onChange={(e) =>
                        setCustomerFields((f) => ({
                          ...f,
                          lastName: e.target.value,
                        }))
                      }
                      placeholder="Doe"
                    />
                  </div>
                )}
                {session.checkoutFields?.email && (
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={customerFields.email}
                      onChange={(e) =>
                        setCustomerFields((f) => ({
                          ...f,
                          email: e.target.value,
                        }))
                      }
                      placeholder="john@example.com"
                    />
                  </div>
                )}
                {session.checkoutFields?.phone && (
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input
                      type="tel"
                      value={customerFields.phone}
                      onChange={(e) =>
                        setCustomerFields((f) => ({
                          ...f,
                          phone: e.target.value,
                        }))
                      }
                      placeholder="+1 (555) 123-4567"
                    />
                  </div>
                )}
                {session.collectCountry && (
                  <div className="space-y-1.5">
                    <Label>Country (ISO code)</Label>
                    <Input
                      type="text"
                      maxLength={2}
                      value={customerFields.country}
                      onChange={(e) =>
                        setCustomerFields((f) => ({
                          ...f,
                          country: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="DE"
                    />
                  </div>
                )}
                {session.collectTaxId && (
                  <div className="space-y-1.5">
                    <Label>Tax / VAT ID (optional)</Label>
                    <Input
                      type="text"
                      value={customerFields.taxId}
                      onChange={(e) =>
                        setCustomerFields((f) => ({
                          ...f,
                          taxId: e.target.value,
                        }))
                      }
                      placeholder="DE123456789"
                    />
                  </div>
                )}
              </div>
            )}

            {!isConnected ? (
              <Button
                size="xl"
                onClick={() => open()}
                disabled={!indexerOnline}
              >
                Connect Wallet
              </Button>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3.5 py-2.5">
                  <MonoText className="text-[13px] text-muted-foreground">
                    {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""}
                  </MonoText>
                  <button
                    onClick={() => open()}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Disconnect
                  </button>
                </div>

                {availablePrices.length > 1 && (
                  <div>
                    <div className="mb-2 text-xs text-muted-foreground">Pay with</div>
                    <div className="flex flex-col gap-1.5">
                      {availablePrices.map((p) => {
                        const selected =
                          p.networkKey === session.networkKey &&
                          p.tokenSymbol === session.tokenSymbol;
                        return (
                          <button
                            key={`${p.networkKey}:${p.tokenSymbol}`}
                            onClick={() =>
                              !selected &&
                              handlePickCurrency(p.networkKey, p.tokenSymbol)
                            }
                            disabled={isPicking || selected}
                            className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs transition-colors ${
                              selected
                                ? "border-primary/50 bg-primary/5"
                                : "border-border bg-background hover:border-primary/40 hover:bg-primary/5"
                            }`}
                          >
                            <span className="font-medium text-foreground">
                              {p.tokenSymbol} on {p.displayLabel}
                            </span>
                            <MonoText className="tabular-nums text-muted-foreground">
                              {formatNativeAmount(
                                BigInt(p.amount),
                                p.decimals,
                                p.tokenSymbol,
                              )}
                            </MonoText>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!session.livemode && address && isInsufficient && (
                  <div className="rounded-md border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/5 p-4 text-sm">
                    <p className="mb-3 font-medium text-[color:var(--warning)]">
                      Insufficient balance for this payment
                    </p>
                    <p className="mb-3 text-xs text-muted-foreground">
                      You&apos;re in test mode. Mint 1000 MockUSDC to your wallet for free to
                      complete this checkout.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleFundWallet}
                      disabled={funding}
                    >
                      {funding ? "Minting…" : "Fund test wallet (1000 MockUSDC)"}
                    </Button>
                    {fundingError && (
                      <p className="mt-3 text-xs text-destructive">{fundingError}</p>
                    )}
                  </div>
                )}

                {canUseCoupon && session.networkKey && (
                  <div className="rounded-md border border-border bg-background p-3 text-xs">
                    {session.appliedCouponId ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-foreground">
                            Coupon applied
                          </span>
                          {session.discountCents ? (
                            <span className="ml-2 text-muted-foreground">
                              — {session.discountCents} off
                            </span>
                          ) : null}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={applyingCoupon}
                          onClick={handleRemoveCoupon}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="coupon">Discount code</Label>
                        <div className="flex gap-2">
                          <Input
                            id="coupon"
                            value={couponInput}
                            onChange={(e) => setCouponInput(e.target.value)}
                            placeholder="SPRING25"
                          />
                          <Button
                            variant="outline"
                            disabled={applyingCoupon || !couponInput.trim()}
                            onClick={handleApplyCoupon}
                          >
                            {applyingCoupon ? "Applying…" : "Apply"}
                          </Button>
                        </div>
                        {couponError && (
                          <p className="text-xs text-destructive">{couponError}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <Button
                  size="xl"
                  onClick={handlePay}
                  disabled={!indexerOnline || payStep !== "idle" || isPicking}
                >
                  {payStep === "idle" &&
                    (isTrial
                      ? "Start free trial"
                      : session.type === "subscription"
                      ? `Subscribe for $${displayAmount} ${formatInterval(
                          session.billingInterval,
                        )
                          .replace("per ", "/")
                          .replace("every 2 weeks", "/2 weeks")}`
                      : `Pay $${displayAmount} ${session.tokenSymbol ?? "USDC"}`)}
                  {payStep === "approving" && `Approving ${session.tokenSymbol ?? "USDC"}...`}
                  {payStep === "paying" && "Confirm payment..."}
                  {payStep === "confirming" && "Processing..."}
                </Button>

                {isTrial && payStep === "idle" && (
                  <p className="text-center text-xs text-muted-foreground">
                    No charge today. Cancel anytime before the trial ends.
                  </p>
                )}

                {payStep === "idle" && activeToken?.signatureScheme === "permit2" && (
                  <p className="text-center text-xs text-muted-foreground">
                    Your wallet will ask for two signatures — one authorizing
                    this payment, one confirming the amount. Neither costs
                    gas.
                  </p>
                )}
                {payStep === "idle" && activeToken?.signatureScheme === "dai-permit" && (
                  <p className="text-center text-xs text-muted-foreground">
                    Your wallet will ask for two signatures — DAI&apos;s
                    legacy allowance grant, then the payment amount. Both are
                    gasless.
                  </p>
                )}

                {payStep !== "idle" && (
                  <Alert className="border-primary/30 bg-primary/5">
                    <AlertDescription className="text-xs">
                      <span className="font-medium text-foreground">
                        Please don&apos;t close this window.
                      </span>{" "}
                      <span className="text-muted-foreground">
                        Your payment is being processed on-chain. Closing now may
                        delay confirmation.
                      </span>
                    </AlertDescription>
                  </Alert>
                )}

                {payError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">{payError}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            Pay securely with {session.tokenSymbol ?? "USDC"} on{" "}
            {session.networkKey &&
            NETWORKS[session.networkKey as keyof typeof NETWORKS]
              ? NETWORKS[session.networkKey as keyof typeof NETWORKS].chainName
              : "the active network"}
          </p>
        </div>
      </div>

      <div className="text-center">
        <span className="text-[11px] tracking-[0.2px] text-muted-foreground">
          Powered by Paylix
        </span>
      </div>

      {(isPolling || status === "viewed") && (
        <div className="border-t border-border px-8 py-3 flex items-center justify-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <span className="text-sm text-muted-foreground">
            Waiting for payment...
          </span>
        </div>
      )}
    </Card>
  );
}
