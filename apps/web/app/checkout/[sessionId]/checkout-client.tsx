"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useAccount, useWaitForTransactionReceipt, useChainId, useSwitchChain, usePublicClient, useSignTypedData } from "wagmi";
import { CheckCircle2, Clock } from "lucide-react";
import { keccak256, stringToBytes } from "viem";
import {
  CONTRACTS,
  ERC20_PERMIT_ABI,
  PAYMENT_VAULT_ABI,
  SUBSCRIPTION_MANAGER_ABI,
} from "@/lib/contracts";
import { CHAIN_ID } from "@/lib/chain";
import { NETWORKS } from "@paylix/config/networks";
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
}

export function CheckoutClient({ session, availablePrices }: CheckoutClientProps) {
  const { open } = useAppKit();
  const { address: wagmiAddress, status: wagmiStatus } = useAccount();
  const { isConnected: appkitConnected, address: appkitAddress } =
    useAppKitAccount();
  const address = wagmiAddress ?? appkitAddress;
  const isConnected = appkitConnected;
  const [status, setStatus] = useState<CheckoutStatus>(session.status);
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

  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [trialEligible, setTrialEligible] = useState<boolean | null>(null);
  const [trialIneligibleReason, setTrialIneligibleReason] = useState<string | null>(null);

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
    chainId: CHAIN_ID,
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
      // Switch to Base Sepolia if not already on it
      if (chainId !== CHAIN_ID) {
        setPayStep("approving");
        await switchChainAsync({ chainId: CHAIN_ID });
      }

      // session.amount is already in native token units (no conversion needed)
      const usdcAmount = BigInt(session.amount);

      const isSubscription = session.type === "subscription";
      const spender = isSubscription
        ? CONTRACTS.subscriptionManager
        : CONTRACTS.paymentVault;

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

      // Fetch the current on-chain permit nonce
      const [nonce] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.usdc,
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
          chainId: CHAIN_ID,
          verifyingContract: CONTRACTS.usdc,
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
        intentSignature = await signTypedDataAsync({
          domain: {
            name: "Paylix SubscriptionManager",
            version: "1",
            chainId: CHAIN_ID,
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
            token: CONTRACTS.usdc,
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
      } else {
        intentSignature = await signTypedDataAsync({
          domain: {
            name: "Paylix PaymentVault",
            version: "1",
            chainId: CHAIN_ID,
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
            token: CONTRACTS.usdc,
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

      // Persist any collected customer form fields (names, email, phone,
      // country, taxId) onto the session before relaying. Failures here are
      // non-fatal — the payment can still go through.
      if (hasCheckoutFields) {
        try {
          await fetch(`/api/checkout/${session.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customer: customerFields }),
          });
        } catch {
          // ignore — never block payment on form persistence
        }
      }

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

  const trialDuration = formatTrialDuration(session.trialDays, session.trialMinutes);
  const productHasTrial = trialDuration !== null && session.type === "subscription";
  const isTrial = productHasTrial && trialEligible !== false;

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

  if (status === "awaiting_currency") {
    return (
      <Card className="w-full max-w-[480px] p-8 shadow-2xl">
        {/* Product Info */}
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

        <h3 className="mb-3 text-sm font-medium">Choose how to pay</h3>
        <div className="flex flex-col gap-2">
          {availablePrices.map((p) => (
            <button
              key={`${p.networkKey}:${p.tokenSymbol}`}
              onClick={() => handlePickCurrency(p.networkKey, p.tokenSymbol)}
              disabled={isPicking}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
            >
              <span className="font-medium">
                {p.tokenSymbol} on {p.displayLabel}
              </span>
              <MonoText className="tabular-nums">
                {formatNativeAmount(BigInt(p.amount), p.decimals, p.tokenSymbol)}
              </MonoText>
            </button>
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

        <div className="mt-8 text-center">
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

        <div className="mt-8 text-center">
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
                  {payStep === "approving" && "Approving USDC..."}
                  {payStep === "paying" && "Confirm payment..."}
                  {payStep === "confirming" && "Processing..."}
                </Button>

                {isTrial && payStep === "idle" && (
                  <p className="text-center text-xs text-muted-foreground">
                    No charge today. Cancel anytime before the trial ends.
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

      <div className="border-t border-border px-8 py-3 text-center">
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
