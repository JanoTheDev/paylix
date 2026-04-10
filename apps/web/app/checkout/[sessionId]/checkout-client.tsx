"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useWriteContract, useWaitForTransactionReceipt, useChainId, useSwitchChain } from "wagmi";
import { keccak256, stringToBytes } from "viem";
import { CONTRACTS, ERC20_ABI, PAYMENT_VAULT_ABI, SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";
import { intervalToSeconds, formatInterval } from "@/lib/billing-intervals";

type CheckoutStatus = "active" | "viewed" | "abandoned" | "completed" | "expired";

interface CheckoutSession {
  id: string;
  status: CheckoutStatus;
  amount: number;
  currency: string;
  chain: string;
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
  billingInterval: string | null;
}

interface CheckoutClientProps {
  session: CheckoutSession;
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function CheckoutClient({ session }: CheckoutClientProps) {
  const { open } = useAppKit();
  const { isConnected, address } = useAppKitAccount();
  const [status, setStatus] = useState<CheckoutStatus>(session.status);
  const [copied, setCopied] = useState(false);
  const [customerFields, setCustomerFields] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const markedViewed = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [indexerOnline, setIndexerOnline] = useState<boolean>(true);
  const [customerUuid, setCustomerUuid] = useState<string | null>(null);

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
    session.checkoutFields &&
    (session.checkoutFields.firstName ||
      session.checkoutFields.lastName ||
      session.checkoutFields.email ||
      session.checkoutFields.phone);

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

  // Abandonment tracking
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (status !== "completed") {
        navigator.sendBeacon(
          `/api/checkout/${session.id}`,
          new Blob(
            [JSON.stringify({ status: "abandoned" })],
            { type: "application/json" }
          )
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [session.id, status]);

  // Poll for status changes
  const startPolling = useCallback(() => {
    if (pollRef.current) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/checkout/${session.id}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "completed") {
          setStatus("completed");
          if (data.customerUuid) setCustomerUuid(data.customerUuid);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          // Redirect after 5s (give user time to see the portal link)
          if (session.successUrl) {
            setTimeout(() => {
              window.location.href = session.successUrl!;
            }, 5000);
          }
        } else if (data.status === "expired") {
          setStatus("expired");
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
  }, [session.id, session.successUrl]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(session.merchantWallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  // Payment flow state
  const [payStep, setPayStep] = useState<"idle" | "approving" | "paying" | "confirming">("idle");
  const [payError, setPayError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  // Start polling when tx confirmed
  useEffect(() => {
    if (txConfirmed) {
      startPolling();
    }
  }, [txConfirmed, startPolling]);

  const handlePay = async () => {
    if (payStep !== "idle") return; // prevent double clicks
    setPayError(null);

    try {
      // Switch to Base Sepolia if not already on it
      if (chainId !== 84532) {
        setPayStep("approving");
        await switchChainAsync({ chainId: 84532 });
      }

      // Convert USDC amount (cents → 6 decimals)
      // session.amount is in cents (100 = $1.00)
      // USDC has 6 decimals, so $1.00 = 1,000,000 units
      const usdcAmount = BigInt(session.amount) * BigInt(10_000); // cents * 10^4 = 10^6 units per dollar

      // Convert IDs to bytes32
      const productIdBytes = keccak256(stringToBytes(session.productId));
      const customerIdBytes = keccak256(
        stringToBytes(session.customerId || "anonymous")
      );

      const isSubscription = session.type === "subscription";
      const spender = isSubscription
        ? CONTRACTS.subscriptionManager
        : CONTRACTS.paymentVault;

      // For subscriptions, approve a large allowance (1000x amount = 1000 charges).
      // For one-time, approve exactly the amount.
      const approvalAmount = isSubscription
        ? usdcAmount * BigInt(1000)
        : usdcAmount;

      // Step 1: Approve USDC spending
      setPayStep("approving");
      const approveHash = await writeContractAsync({
        address: CONTRACTS.usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, approvalAmount],
        chainId: 84532, // Base Sepolia
      });
      console.log("Approve tx:", approveHash);

      // Wait a moment for approval to propagate
      await new Promise((r) => setTimeout(r, 2000));

      // Step 2: Call createPayment or createSubscription
      setPayStep("paying");
      let payHash: `0x${string}`;

      if (isSubscription) {
        const intervalSeconds = intervalToSeconds(session.billingInterval);
        if (intervalSeconds <= 0) {
          throw new Error("Invalid billing interval for subscription");
        }

        payHash = await writeContractAsync({
          address: CONTRACTS.subscriptionManager,
          abi: SUBSCRIPTION_MANAGER_ABI,
          functionName: "createSubscription",
          args: [
            CONTRACTS.usdc,
            session.merchantWallet as `0x${string}`,
            usdcAmount,
            BigInt(intervalSeconds),
            productIdBytes,
            customerIdBytes,
          ],
          chainId: 84532, // Base Sepolia
        });
        console.log("Subscription tx:", payHash);
      } else {
        payHash = await writeContractAsync({
          address: CONTRACTS.paymentVault,
          abi: PAYMENT_VAULT_ABI,
          functionName: "createPayment",
          args: [
            CONTRACTS.usdc,
            session.merchantWallet as `0x${string}`,
            usdcAmount,
            productIdBytes,
            customerIdBytes,
          ],
          chainId: 84532, // Base Sepolia
        });
        console.log("Payment tx:", payHash);
      }

      setTxHash(payHash);
      setPayStep("confirming");
    } catch (err) {
      console.error("Payment failed:", err);
      const msg = err instanceof Error ? err.message : "Payment failed";
      setPayError(msg.slice(0, 200));
      setPayStep("idle");
    }
  };

  const displayAmount = formatAmount(session.amount);

  if (status === "completed") {
    const isSubscription = session.type === "subscription";
    return (
      <div
        className="w-full max-w-[480px] rounded-[16px] border border-[rgba(148,163,184,0.16)] bg-[#18181e] p-8"
        style={{ boxShadow: "0 8px 32px rgba(0, 0, 0, 0.40)" }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#22c55e12] border border-[#22c55e30]">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="mb-2 text-[20px] font-semibold tracking-[-0.4px] text-[#f0f0f3]">
            {isSubscription ? "Subscription active!" : "Payment confirmed!"}
          </h2>
          <p className="text-[14px] leading-[1.55] text-[#94a3b8]">
            {isSubscription
              ? `You'll be charged $${displayAmount} ${formatInterval(session.billingInterval)}. First charge completed.`
              : `$${displayAmount} ${session.currency} received successfully.`}
          </p>

          {customerUuid && (
            <a
              href={`/portal/${customerUuid}`}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-[8px] border border-[rgba(148,163,184,0.12)] px-[18px] text-[14px] font-medium text-[#f0f0f3] transition-colors duration-150 hover:border-[rgba(148,163,184,0.20)] hover:bg-[#111116]"
            >
              {isSubscription ? "Manage subscription" : "View purchase history"}
            </a>
          )}

          {session.successUrl && (
            <p className="mt-4 text-[12px] text-[#64748b]">
              Redirecting you back in a few seconds...
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <span className="text-[12px] tracking-[0.2px] text-[#64748b]">
            Powered by Paylix
          </span>
        </div>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div
        className="w-full max-w-[480px] rounded-[16px] border border-[rgba(148,163,184,0.16)] bg-[#18181e] p-8 text-center"
        style={{ boxShadow: "0 8px 32px rgba(0, 0, 0, 0.40)" }}
      >
        <div className="mb-3 text-[40px] text-[#fbbf24]">&#x23F3;</div>
        <h1 className="mb-2 text-[20px] font-semibold tracking-[-0.4px] text-[#f0f0f3]">
          This checkout has expired
        </h1>
        <p className="text-[14px] leading-[1.55] text-[#94a3b8]">
          This payment session is no longer active. Please request a new checkout link.
        </p>
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-[480px] rounded-[16px] border border-[rgba(148,163,184,0.16)] bg-[#18181e] p-8"
      style={{ boxShadow: "0 8px 32px rgba(0, 0, 0, 0.40)" }}
    >
      {/* Product Info */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.4px] text-[#f0f0f3]">
              {session.productName}
            </h1>
            {session.type === "subscription" && (
              <span className="inline-flex items-center rounded-full border border-[#06d6a033] bg-[#06d6a010] px-[10px] py-[3px] text-[11px] font-semibold uppercase tracking-[0.3px] text-[#06d6a0]">
                Subscription
              </span>
            )}
          </div>
          {session.productDescription && (
            <p className="mt-1 text-[14px] leading-[1.55] text-[#94a3b8]">
              {session.productDescription}
            </p>
          )}
          {session.type === "subscription" && (
            <p className="mt-2 text-[13px] text-[#94a3b8]">
              You&apos;ll be charged <span className="font-medium text-[#f0f0f3]">${displayAmount} {session.currency}</span> {formatInterval(session.billingInterval)} until cancelled.
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <div className="flex items-baseline gap-2">
            <span
              className="text-[24px] font-semibold leading-[1.2] tracking-[-0.3px] text-[#f0f0f3]"
              style={{ fontFamily: '"Geist Mono", ui-monospace, monospace', fontVariantNumeric: "tabular-nums" }}
            >
              ${displayAmount}
            </span>
            <span className="inline-flex items-center rounded-[6px] border border-[#2775ca33] bg-[#2775ca14] px-[10px] py-[3px] text-[11px] font-semibold tracking-[0.3px] text-[#2775ca]"
              style={{ fontFamily: '"Geist Mono", ui-monospace, monospace' }}
            >
              {session.currency}
            </span>
          </div>
          {session.type === "subscription" && (
            <span className="text-[11px] text-[#64748b]">
              {formatInterval(session.billingInterval)}
            </span>
          )}
        </div>
      </div>

      {/* Indexer Offline Warning */}
      {!indexerOnline && (
        <div className="mt-6 rounded-lg border border-[#fbbf2430] bg-[#fbbf2412] p-4">
          <p className="text-sm font-medium text-[#fbbf24]">Payment processing unavailable</p>
          <p className="mt-1 text-[13px] text-[#94a3b8]">
            Our payment system is temporarily down. Please try again in a few minutes.
          </p>
        </div>
      )}

      {/* Customer Fields */}
      {hasCheckoutFields && (
        <>
          <div className="my-6 h-px bg-[rgba(148,163,184,0.08)]" />
          <div className="flex flex-col gap-3">
            {session.checkoutFields?.firstName && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium leading-none tracking-[0.1px] text-[#94a3b8]">
                  First Name
                </label>
                <input
                  type="text"
                  value={customerFields.firstName}
                  onChange={(e) => setCustomerFields((f) => ({ ...f, firstName: e.target.value }))}
                  placeholder="John"
                  className="h-10 w-full rounded-[8px] border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5 text-[14px] text-[#f0f0f3] placeholder-[#64748b] outline-none transition-[border,box-shadow] duration-150 focus:border-[#06d6a0] focus:ring-[3px] focus:ring-[#06d6a020]"
                />
              </div>
            )}
            {session.checkoutFields?.lastName && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium leading-none tracking-[0.1px] text-[#94a3b8]">
                  Last Name
                </label>
                <input
                  type="text"
                  value={customerFields.lastName}
                  onChange={(e) => setCustomerFields((f) => ({ ...f, lastName: e.target.value }))}
                  placeholder="Doe"
                  className="h-10 w-full rounded-[8px] border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5 text-[14px] text-[#f0f0f3] placeholder-[#64748b] outline-none transition-[border,box-shadow] duration-150 focus:border-[#06d6a0] focus:ring-[3px] focus:ring-[#06d6a020]"
                />
              </div>
            )}
            {session.checkoutFields?.email && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium leading-none tracking-[0.1px] text-[#94a3b8]">
                  Email
                </label>
                <input
                  type="email"
                  value={customerFields.email}
                  onChange={(e) => setCustomerFields((f) => ({ ...f, email: e.target.value }))}
                  placeholder="john@example.com"
                  className="h-10 w-full rounded-[8px] border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5 text-[14px] text-[#f0f0f3] placeholder-[#64748b] outline-none transition-[border,box-shadow] duration-150 focus:border-[#06d6a0] focus:ring-[3px] focus:ring-[#06d6a020]"
                />
              </div>
            )}
            {session.checkoutFields?.phone && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium leading-none tracking-[0.1px] text-[#94a3b8]">
                  Phone
                </label>
                <input
                  type="tel"
                  value={customerFields.phone}
                  onChange={(e) => setCustomerFields((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+1 (555) 123-4567"
                  className="h-10 w-full rounded-[8px] border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5 text-[14px] text-[#f0f0f3] placeholder-[#64748b] outline-none transition-[border,box-shadow] duration-150 focus:border-[#06d6a0] focus:ring-[3px] focus:ring-[#06d6a020]"
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Payment Section */}
      <div className="my-6 h-px bg-[rgba(148,163,184,0.08)]" />

      {/* Connect Wallet */}
      {!isConnected ? (
        <button
          onClick={() => open()}
          disabled={!indexerOnline}
          className="h-10 w-full rounded-[8px] bg-[#06d6a0] px-[18px] text-[14px] font-medium text-[#07070a] transition-[background,box-shadow] duration-150 hover:bg-[#05bf8e] active:bg-[#04a87b] focus:outline-none focus:ring-[3px] focus:ring-[#06d6a060] focus:ring-offset-2 focus:ring-offset-[#18181e] disabled:cursor-not-allowed disabled:bg-[#1f1f26] disabled:text-[#64748b] disabled:hover:bg-[#1f1f26]"
        >
          Connect Wallet
        </button>
      ) : (
        <>
          <div className="mb-4 rounded-[8px] border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5 flex items-center justify-between">
            <span className="text-[13px] text-[#94a3b8]" style={{ fontFamily: '"Geist Mono", monospace' }}>
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""}
            </span>
            <button
              onClick={() => open()}
              className="text-[12px] text-[#94a3b8] hover:text-[#f0f0f3]"
            >
              Disconnect
            </button>
          </div>
          <button
            onClick={handlePay}
            disabled={!indexerOnline || payStep !== "idle"}
            className="h-10 w-full rounded-[8px] bg-[#06d6a0] px-[18px] text-[14px] font-medium text-[#07070a] transition-[background,box-shadow] duration-150 hover:bg-[#05bf8e] active:bg-[#04a87b] focus:outline-none focus:ring-[3px] focus:ring-[#06d6a060] focus:ring-offset-2 focus:ring-offset-[#18181e] disabled:cursor-not-allowed disabled:bg-[#1f1f26] disabled:text-[#64748b] disabled:hover:bg-[#1f1f26]"
          >
            {payStep === "idle" &&
              (session.type === "subscription"
                ? `Subscribe for $${displayAmount} ${formatInterval(session.billingInterval).replace("per ", "/").replace("every 2 weeks", "/2 weeks")}`
                : `Pay $${displayAmount} ${session.currency}`)}
            {payStep === "approving" && "Approving USDC..."}
            {payStep === "paying" && "Confirm payment..."}
            {payStep === "confirming" && "Processing..."}
          </button>
          {payError && (
            <div className="mt-3 rounded-lg border border-[#f8717130] bg-[#f8717112] p-3 text-[12px] text-[#f87171]">
              {payError}
            </div>
          )}
        </>
      )}

      {/* Info note */}
      <p className="mt-4 text-center text-[12px] text-[#64748b]">
        Connect a wallet with {session.currency} on Base Sepolia to pay securely through our payment contract.
      </p>

      {/* Polling Status */}
      {pollRef.current !== null || status === "viewed" ? (
        <div className="mt-6 flex items-center justify-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#06d6a0] opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#06d6a0]" />
          </span>
          <span className="text-[14px] text-[#94a3b8]">
            Waiting for payment...
          </span>
        </div>
      ) : null}

      {/* Footer */}
      <div className="mt-8 text-center">
        <span className="text-[12px] tracking-[0.2px] text-[#64748b]">
          Powered by Paylix
        </span>
      </div>
    </div>
  );
}
