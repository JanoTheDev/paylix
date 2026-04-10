"use client";

import { useEffect, useState } from "react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { CONTRACTS, SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";

interface CancelSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onChainId: string | null;
  productName?: string | null;
  /** Optional force-cancel (DB only). Only shown for the merchant dashboard. */
  onForceCancel?: () => Promise<void> | void;
  /** Called once the cancel tx is confirmed on-chain. */
  onConfirmed?: () => void;
}

type Step = "idle" | "switching" | "signing" | "confirming" | "confirmed" | "error";

export default function CancelSubscriptionModal({
  open,
  onClose,
  onChainId,
  productName,
  onForceCancel,
  onConfirmed,
}: CancelSubscriptionModalProps) {
  const { open: openAppKit } = useAppKit();
  const { isConnected, address } = useAppKitAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [forceLoading, setForceLoading] = useState(false);

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setStep("idle");
      setError(null);
      setTxHash(null);
      setForceLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (txConfirmed && step === "confirming") {
      setStep("confirmed");
      onConfirmed?.();
    }
  }, [txConfirmed, step, onConfirmed]);

  if (!open) return null;

  async function handleCancelOnChain() {
    if (!onChainId) {
      setError("This subscription has no on-chain ID. Use force cancel instead.");
      return;
    }
    setError(null);
    try {
      if (chainId !== 84532) {
        setStep("switching");
        await switchChainAsync({ chainId: 84532 });
      }
      setStep("signing");
      const hash = await writeContractAsync({
        address: CONTRACTS.subscriptionManager,
        abi: SUBSCRIPTION_MANAGER_ABI,
        functionName: "cancelSubscription",
        args: [BigInt(onChainId)],
        chainId: 84532,
      });
      setTxHash(hash);
      setStep("confirming");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cancel failed";
      setError(msg.slice(0, 240));
      setStep("error");
    }
  }

  async function handleForceCancel() {
    if (!onForceCancel) return;
    setForceLoading(true);
    try {
      await onForceCancel();
    } finally {
      setForceLoading(false);
    }
  }

  const truncated = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(8px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#18181e] p-6"
        style={{ boxShadow: "0 4px 16px rgba(0, 0, 0, 0.30)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.4px] text-[#f0f0f3]">
              Cancel subscription
            </h2>
            {productName && (
              <p className="mt-1 text-[13px] leading-[1.5] text-[#94a3b8]">
                {productName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#111116] hover:text-[#f0f0f3]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {step === "confirmed" ? (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#22c55e30] bg-[#22c55e12]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="mb-1 text-[16px] font-medium text-[#f0f0f3]">
              Subscription cancelled
            </h3>
            <p className="text-[13px] leading-[1.5] text-[#94a3b8]">
              The cancel transaction was confirmed on-chain. The dashboard will update shortly.
            </p>
            <button
              onClick={onClose}
              className="mt-5 h-10 rounded-lg border border-[rgba(148,163,184,0.12)] bg-transparent px-[18px] text-[14px] font-medium text-[#f0f0f3] transition-colors hover:bg-[#111116] hover:border-[rgba(148,163,184,0.20)]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-[14px] leading-[1.55] text-[#94a3b8]">
              {isConnected
                ? "Sign the cancel transaction with your connected wallet. The subscription will stop billing once the transaction is confirmed on Base Sepolia."
                : "Connect your wallet to sign the on-chain cancel transaction."}
            </p>

            {!onChainId && (
              <div className="mt-4 rounded-lg border border-[#fbbf2430] bg-[#fbbf2412] p-3 text-[12px] text-[#fbbf24]">
                This subscription has no on-chain ID. It may have been created before
                the contract integration. You can only force-cancel it in the database.
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-lg border border-[#f8717130] bg-[#f8717112] p-3 text-[12px] text-[#f87171]">
                {error}
              </div>
            )}

            {!isConnected ? (
              <button
                onClick={() => openAppKit()}
                className="mt-5 h-10 w-full rounded-lg bg-[#06d6a0] px-[18px] text-[14px] font-medium text-[#07070a] transition-colors hover:bg-[#05bf8e] active:bg-[#04a87b] focus:outline-none focus:ring-[3px] focus:ring-[#06d6a060] focus:ring-offset-2 focus:ring-offset-[#18181e]"
              >
                Connect Wallet
              </button>
            ) : (
              <>
                <div className="mt-5 mb-3 flex items-center justify-between rounded-lg border border-[rgba(148,163,184,0.12)] bg-[#07070a] px-3.5 py-2.5">
                  <span className="text-[13px] text-[#94a3b8]" style={{ fontFamily: '"Geist Mono", monospace' }}>
                    {truncated}
                  </span>
                  <button
                    onClick={() => openAppKit()}
                    className="text-[12px] text-[#94a3b8] transition-colors hover:text-[#f0f0f3]"
                  >
                    Switch
                  </button>
                </div>
                <button
                  onClick={handleCancelOnChain}
                  disabled={!onChainId || step === "switching" || step === "signing" || step === "confirming"}
                  className="h-10 w-full rounded-lg border border-[#f8717130] bg-transparent px-[18px] text-[14px] font-medium text-[#f87171] transition-colors hover:bg-[#f8717112] hover:border-[#f8717150] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {step === "idle" && "Confirm Cancel"}
                  {step === "switching" && "Switching to Base Sepolia..."}
                  {step === "signing" && "Waiting for signature..."}
                  {step === "confirming" && "Confirming on Base..."}
                  {step === "error" && "Try again"}
                </button>
              </>
            )}

            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-[rgba(148,163,184,0.08)]" />
              <button
                onClick={onClose}
                className="text-[13px] text-[#94a3b8] transition-colors hover:text-[#f0f0f3]"
              >
                Dismiss
              </button>
              <div className="h-px flex-1 bg-[rgba(148,163,184,0.08)]" />
            </div>

            {onForceCancel && (
              <div className="mt-5 rounded-lg border border-[rgba(148,163,184,0.12)] bg-[#07070a] p-4">
                <p className="text-[12px] leading-[1.5] text-[#64748b]">
                  Don&apos;t have the merchant wallet handy? You can mark the
                  subscription as cancelled in the database only. The on-chain
                  subscription will remain active until cancelled.
                </p>
                <button
                  onClick={handleForceCancel}
                  disabled={forceLoading}
                  className="mt-3 h-9 rounded-lg border border-[rgba(148,163,184,0.12)] bg-transparent px-3.5 text-[12px] font-medium text-[#94a3b8] transition-colors hover:bg-[#111116] hover:text-[#f0f0f3] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {forceLoading ? "Cancelling..." : "Force cancel (DB only)"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
