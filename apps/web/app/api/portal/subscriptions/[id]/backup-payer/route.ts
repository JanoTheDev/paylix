import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requirePortalCustomer,
  requireOwnedSubscription,
} from "@/lib/portal-auth";
import { apiError } from "@/lib/api-error";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { createRelayerClient } from "@/lib/relayer";
import { SUBSCRIPTION_MANAGER_ABI } from "@/lib/contracts";

// 65-byte EIP-712 signature.
const SIG65 = /^0x[0-9a-fA-F]{130}$/;

const schema = z.object({
  customerId: z.string().uuid(),
  token: z.string(),
  backup: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  // Signed by the PRIMARY subscriber (BackupPayerAuth).
  subscriberAuthSig: z.string().regex(SIG65, "subscriberAuthSig must be a 65-byte hex signature"),
  authDeadline: z.number().int().positive(),
  // Signed by the BACKUP WALLET ITSELF (BackupPayerConsent). This is the
  // whole point of SC-01: an ERC-20 allowance is spending power, not
  // agreement to bankroll a specific subscription. Without it, any address
  // carrying a standing allowance — including wallets whose subscription was
  // long since cancelled — could be attached as a backup by an attacker and
  // drained to an attacker-controlled merchant.
  backupConsentSig: z.string().regex(SIG65, "backupConsentSig must be a 65-byte hex signature"),
  // Per-charge ceiling the backup wallet consented to, in the token's native
  // units. Part of the consent digest, so it cannot be altered server-side
  // without invalidating the signature.
  maxAmount: z.string().regex(/^\d+$/, "maxAmount must be a non-negative integer string"),
  consentDeadline: z.number().int().positive(),
  permitValue: z.string().regex(/^\d+$/),
  permitDeadline: z.number().int().positive(),
  v: z.number().int(),
  r: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  s: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

/**
 * Customer attaches a backup payer to their subscription.
 *
 * Three signatures are involved and they are NOT interchangeable:
 *
 *  1. `subscriberAuthSig` — EIP-712 `BackupPayerAuth(subscriptionId, backup,
 *     nonce, deadline)`, signed by the primary subscriber. Its nonce comes
 *     from `getBackupAuthNonce(subscriber)`.
 *  2. `backupConsentSig` — EIP-712 `BackupPayerConsent(subscriptionId,
 *     subscriber, token, maxAmount, nonce, deadline)`, signed by the backup
 *     wallet. Its nonce comes from **`getBackupConsentNonce(backup)`** — a
 *     different counter from both `getBackupAuthNonce` and `getIntentNonce`.
 *  3. the EIP-2612 permit (`v`/`r`/`s`) from the backup wallet, granting the
 *     contract allowance.
 *
 * This route cannot manufacture (2) — it has to be collected from the backup
 * wallet in the browser. Until the portal UI prompts for it, requests here
 * fail validation with `validation_failed`, which is the correct interim
 * state: the alternative is submitting a transaction that reverts on-chain.
 *
 * `subscriber` and `token` in the consent digest are read from the on-chain
 * subscription by the contract, not taken from this request — the UI must
 * build its typed data from the same on-chain values or the digest will not
 * reproduce.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: subscriptionId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "validation_failed",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const p = parsed.data;
  const portal = await requirePortalCustomer(request, p);
  if (!portal.ok) return portal.response;

  // Ownership is part of the WHERE clause now. The previous check loaded the
  // subscription unscoped, then "verified" ownership with a redundant
  // double-`eq` on the same customers column — which compared the row to
  // itself and never actually constrained anything.
  const owned = await requireOwnedSubscription(portal.customerId, subscriptionId);
  if (!owned.ok) return owned.response;
  const sub = owned.subscription;

  if (!sub.onChainId) {
    return apiError(
      "not_onchain",
      "Subscription is not yet on-chain (still in trial)",
      409,
    );
  }
  if (sub.status !== "active" && sub.status !== "past_due") {
    return apiError("invalid_status", "Subscription not active", 409);
  }

  // ── Consent bounds ──────────────────────────────────────────────────────
  // Every check below can only REJECT. `maxAmount` is part of the
  // BackupPayerConsent digest, so altering it server-side would invalidate
  // the signature — and raising it would be exactly the abuse this endpoint
  // exists to prevent. It is forwarded verbatim.
  const maxAmount = BigInt(p.maxAmount);
  const permitValue = BigInt(p.permitValue);

  if (maxAmount <= 0n) {
    // Mirrors the contract's `require(p.maxAmount > 0, "Zero backup cap")`.
    return apiError("invalid_cap", "maxAmount must be greater than zero", 400);
  }
  if (permitValue < maxAmount) {
    // Mirrors `require(p.permitValue >= p.maxAmount, "Permit < backup cap")`.
    return apiError(
      "permit_below_cap",
      "permitValue must be at least maxAmount",
      400,
    );
  }

  // `maxAmount` is a PER-CHARGE cap, not a lifetime one: after N missed
  // cycles a merchant can pull N × maxAmount in a single block, bounded only
  // by the standing allowance. The contract can't express a lifetime cap, so
  // bound the allowance instead — a backup wallet consenting to cover one
  // cycle should not be granting an unlimited approval.
  const maxPrefundedCycles = 12n;
  if (permitValue > maxAmount * maxPrefundedCycles) {
    return apiError(
      "permit_too_large",
      `permitValue may not exceed ${maxPrefundedCycles}× maxAmount. ` +
        "A backup payer's allowance is capped so a run of missed cycles " +
        "cannot be collected all at once.",
      400,
    );
  }

  // Bound how long a signed consent stays usable. The contract only checks
  // `block.timestamp <= deadline`, so a far-future deadline is effectively a
  // standing authorization the backup wallet can't easily revoke.
  const nowSec = Math.floor(Date.now() / 1000);
  const maxDeadlineWindowSec = 60 * 60; // 1 hour
  for (const [label, value] of [
    ["authDeadline", p.authDeadline],
    ["consentDeadline", p.consentDeadline],
    ["permitDeadline", p.permitDeadline],
  ] as const) {
    if (value <= nowSec) {
      return apiError("deadline_passed", `${label} is in the past`, 400);
    }
    if (value > nowSec + maxDeadlineWindowSec) {
      return apiError(
        "deadline_out_of_window",
        `${label} must be within ${maxDeadlineWindowSec / 60} minutes`,
        400,
      );
    }
  }

  const deployment = resolveDeploymentForMode(sub.livemode);
  if (
    sub.contractAddress &&
    sub.contractAddress.toLowerCase() !==
      deployment.subscriptionManager.toLowerCase()
  ) {
    return apiError(
      "deployment_mismatch",
      "Subscription is on a different contract deployment",
      409,
    );
  }

  const relayer = createRelayerClient(deployment);
  try {
    const txHash = await relayer.writeContract({
      address: deployment.subscriptionManager,
      abi: SUBSCRIPTION_MANAGER_ABI,
      functionName: "addSubscriptionBackupPayer",
      args: [
        {
          subscriptionId: BigInt(sub.onChainId),
          backup: p.backup as `0x${string}`,
          authDeadline: BigInt(p.authDeadline),
          maxAmount: BigInt(p.maxAmount),
          consentDeadline: BigInt(p.consentDeadline),
          permitValue: BigInt(p.permitValue),
          permitDeadline: BigInt(p.permitDeadline),
          v: p.v,
          r: p.r as `0x${string}`,
          s: p.s as `0x${string}`,
        },
        // BackupPayerAuth — signed by the primary subscriber.
        p.subscriberAuthSig as `0x${string}`,
        // BackupPayerConsent — signed by the backup wallet. Cannot be
        // synthesised here; it is collected in the browser from that wallet.
        p.backupConsentSig as `0x${string}`,
      ],
    });
    return NextResponse.json({ txHash });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Relay failed";
    return apiError("relay_failed", message.slice(0, 400), 502);
  }
}
