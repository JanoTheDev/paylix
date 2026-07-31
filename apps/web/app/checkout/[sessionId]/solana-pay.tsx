"use client";

import { useState, useMemo } from "react";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { keccak256, stringToBytes } from "viem";
import {
  associatedTokenAddress,
  buildCreatePaymentIx,
  buildCreateSubscriptionIx,
  buildSplApproveIx,
  subscriptionPda,
} from "@/lib/solana-instructions";
import { MonoText } from "@/components/mono-text";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";

type PayStep = "idle" | "approving" | "paying" | "confirming" | "complete";

interface SolanaPayProps {
  sessionId: string;
  productName: string;
  productDescription: string | null;
  productId: string;
  amount: bigint;
  decimals: number;
  tokenSymbol: string;
  networkKey: "solana" | "solana-devnet";
  /** Merchant's Solana receiver pubkey (base58). */
  merchantWallet: string;
  /** Token mint base58. */
  mint: string;
  /** PaymentVault or SubscriptionManager program id. */
  programId: string;
  /** Platform fee-receiving pubkey (base58). */
  platformWallet: string;
  isSubscription: boolean;
  intervalSeconds: number;
  /** Opaque id the on-chain subscription is seeded with — must be unique. */
  subscriptionId: bigint;
  /** Called when the on-chain tx confirms so the outer page flips status. */
  onComplete(txSig: string): void;
}

function formatAmount(amount: bigint, decimals: number, symbol: string): string {
  const d = BigInt(10) ** BigInt(decimals);
  const whole = amount / d;
  const frac = amount % d;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
    .slice(0, 4);
  return `${whole}${fracStr ? "." + fracStr : ""} ${symbol}`;
}

function makeId32(seed: string): Uint8Array {
  const hex = keccak256(stringToBytes(seed));
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(2 + i * 2, 2 + i * 2 + 2), 16);
  }
  return out;
}

export function SolanaPay(props: SolanaPayProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [payStep, setPayStep] = useState<PayStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const amountStr = useMemo(
    () => formatAmount(props.amount, props.decimals, props.tokenSymbol),
    [props.amount, props.decimals, props.tokenSymbol],
  );

  async function pay(): Promise<void> {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setError("Connect a Solana wallet first.");
      return;
    }
    setError(null);
    try {
      const programId = new PublicKey(props.programId);
      const mint = new PublicKey(props.mint);
      const merchant = new PublicKey(props.merchantWallet);
      const platform = new PublicKey(props.platformWallet);
      const buyer = wallet.publicKey;

      const buyerAta = associatedTokenAddress(mint, buyer);
      const merchantAta = associatedTokenAddress(mint, merchant);
      const platformAta = associatedTokenAddress(mint, platform);

      const productIdBytes = makeId32(props.productId);
      const customerIdBytes = makeId32(props.sessionId);

      const ixs = [];

      if (props.isSubscription) {
        setPayStep("approving");
        // Buyer delegates the subscription PDA as SPL token delegate for
        // amount × 1000 — covers many recurring cycles without re-prompting.
        const subPda = subscriptionPda(programId, props.subscriptionId);
        ixs.push(
          buildSplApproveIx({
            source: buyerAta,
            delegate: subPda,
            owner: buyer,
            amount: props.amount * BigInt(1000),
          }),
        );
        ixs.push(
          buildCreateSubscriptionIx({
            programId,
            subscriptionId: props.subscriptionId,
            mint,
            buyer,
            buyerAta,
            merchantAta,
            platformAta,
            amount: props.amount,
            intervalSeconds: BigInt(props.intervalSeconds),
            productId: productIdBytes,
            customerId: customerIdBytes,
          }),
        );
      } else {
        setPayStep("paying");
        ixs.push(
          buildCreatePaymentIx({
            programId,
            mint,
            buyer,
            buyerAta,
            merchantAta,
            platformAta,
            amount: props.amount,
            productId: productIdBytes,
            customerId: customerIdBytes,
          }),
        );
      }

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("finalized");
      const msg = new TransactionMessage({
        payerKey: buyer,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);

      setPayStep("paying");
      const signedRaw = await wallet.signTransaction(
        tx as unknown as Transaction,
      );
      const sig = await connection.sendRawTransaction(
        (signedRaw as unknown as VersionedTransaction).serialize(),
      );
      setTxSig(sig);
      setPayStep("confirming");
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      setPayStep("complete");
      props.onComplete(sig);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPayStep("idle");
    }
  }

  const clusterLabel = props.networkKey === "solana" ? "Mainnet" : "Devnet";

  return (
    <Card className="w-full max-w-[480px] p-8 shadow-floating">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.4px]">{props.productName}</h1>
        {props.productDescription && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {props.productDescription}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Solana · {clusterLabel}</span>
        </div>
        <div className="mb-3">
          <div className="text-[11px] text-muted-foreground">Amount</div>
          <MonoText className="text-lg font-semibold tabular-nums">{amountStr}</MonoText>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Merchant</div>
          <MonoText className="text-xs break-all">{props.merchantWallet}</MonoText>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <WalletMultiButton />
        {wallet.connected && wallet.publicKey && (
          <Button size="lg" onClick={pay} disabled={payStep !== "idle"}>
            {payStep === "idle" &&
              (props.isSubscription
                ? `Subscribe for ${amountStr}`
                : `Pay ${amountStr}`)}
            {payStep === "approving" && "Approving delegate…"}
            {payStep === "paying" && "Confirm in wallet…"}
            {payStep === "confirming" && "Waiting for confirmation…"}
            {payStep === "complete" && "Payment sent"}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {txSig && (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          tx: <MonoText>{txSig.slice(0, 8)}…{txSig.slice(-8)}</MonoText>
        </p>
      )}

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Powered by Paylix
      </p>
    </Card>
  );
}
