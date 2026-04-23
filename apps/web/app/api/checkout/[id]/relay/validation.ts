/**
 * Pure validation for the relay route. Extracted so the business rules
 * are unit-testable without mocking Next.js request/response.
 */

import {
  NETWORKS,
  assertValidNetworkKey,
  assertValidTokenSymbol,
  type NetworkKey,
} from "@paylix/config/networks";

export interface RelayRequestBody {
  buyer?: unknown;
  deadline?: unknown;
  // EIP-2612 permit fields (required when the token's signatureScheme='eip2612')
  v?: unknown;
  r?: unknown;
  s?: unknown;
  permitValue?: unknown;
  // Permit2 fields (required when the token's signatureScheme='permit2')
  permit2Nonce?: unknown;
  permit2Signature?: unknown;
  intentSignature?: unknown;
  networkKey?: unknown;
  tokenSymbol?: unknown;
}

export interface ValidatedRelayInput {
  buyer: `0x${string}`;
  deadline: bigint;
  // EIP-2612 path — optional, populated only when the token uses that scheme.
  v: number | null;
  r: `0x${string}` | null;
  s: `0x${string}` | null;
  permitValue: bigint | null;
  // Permit2 path — optional, populated only for Permit2 tokens.
  permit2Nonce: bigint | null;
  permit2Signature: `0x${string}` | null;
  intentSignature: `0x${string}`;
  networkKey: string;
  tokenSymbol: string;
}

export type ValidationError =
  | { code: "invalid_body"; message: string }
  | { code: "session_not_found" }
  | { code: "session_expired" }
  | { code: "session_not_payable"; status: string }
  | { code: "session_already_relayed" }
  | { code: "deadline_passed" };

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
// 65-byte EIP-191/712 signature: r (32) || s (32) || v (1) = 130 hex chars
const HEX_SIG65_RE = /^0x[0-9a-fA-F]{130}$/;

/**
 * Normalize the permit signature recovery parameter. Some wallets return
 * v as 0 or 1 (EIP-155); OpenZeppelin's ERC20Permit ecrecover expects 27 or
 * 28. The client already normalizes, but we do it server-side too as a
 * belt-and-braces check against third-party SDKs posting raw signatures.
 */
export function normalizePermitV(v: number): number {
  if (v === 0 || v === 1) return v + 27;
  return v;
}

export function parseRelayBody(
  body: RelayRequestBody,
): { ok: true; value: ValidatedRelayInput } | { ok: false; error: ValidationError } {
  const {
    buyer,
    deadline,
    v,
    r,
    s,
    permitValue,
    permit2Nonce,
    permit2Signature,
    intentSignature,
    networkKey,
    tokenSymbol,
  } = body;

  if (typeof buyer !== "string" || !HEX_ADDRESS_RE.test(buyer)) {
    return { ok: false, error: { code: "invalid_body", message: "buyer must be a 0x-prefixed 20-byte hex address" } };
  }
  if (typeof deadline !== "string" && typeof deadline !== "number") {
    return { ok: false, error: { code: "invalid_body", message: "deadline must be a string or number" } };
  }
  if (typeof intentSignature !== "string" || !HEX_SIG65_RE.test(intentSignature)) {
    return {
      ok: false,
      error: {
        code: "invalid_body",
        message: "intentSignature must be a 0x-prefixed 65-byte hex string",
      },
    };
  }

  // Scheme detection: if permit2Nonce + permit2Signature are both provided,
  // the payload is a Permit2 request. Otherwise fall back to the EIP-2612
  // v/r/s/permitValue shape. Exactly one shape must be present.
  const hasPermit2 = permit2Nonce !== undefined || permit2Signature !== undefined;
  const has2612 = v !== undefined || r !== undefined || s !== undefined || permitValue !== undefined;
  if (hasPermit2 && has2612) {
    return {
      ok: false,
      error: {
        code: "invalid_body",
        message: "Request cannot mix EIP-2612 (v/r/s/permitValue) and Permit2 (permit2Nonce/permit2Signature) fields",
      },
    };
  }

  let deadlineBig: bigint;
  try {
    deadlineBig = BigInt(deadline as string | number);
  } catch {
    return { ok: false, error: { code: "invalid_body", message: "deadline must be representable as bigint" } };
  }
  if (deadlineBig <= BigInt(0)) {
    return { ok: false, error: { code: "invalid_body", message: "deadline must be positive" } };
  }

  // EIP-2612 fields — validated when not in Permit2 mode. Backwards compatible:
  // older clients always send these and never set the permit2* fields.
  let normalizedV: number | null = null;
  let rHex: `0x${string}` | null = null;
  let sHex: `0x${string}` | null = null;
  let permitValueBig: bigint | null = null;
  if (!hasPermit2) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) {
      return { ok: false, error: { code: "invalid_body", message: "v must be a uint8 (0-255)" } };
    }
    if (typeof r !== "string" || !HEX_BYTES32_RE.test(r)) {
      return { ok: false, error: { code: "invalid_body", message: "r must be a 0x-prefixed 32-byte hex string" } };
    }
    if (typeof s !== "string" || !HEX_BYTES32_RE.test(s)) {
      return { ok: false, error: { code: "invalid_body", message: "s must be a 0x-prefixed 32-byte hex string" } };
    }
    if (typeof permitValue !== "string" && typeof permitValue !== "number") {
      return { ok: false, error: { code: "invalid_body", message: "permitValue must be a string or number" } };
    }
    try {
      permitValueBig = BigInt(permitValue as string | number);
    } catch {
      return { ok: false, error: { code: "invalid_body", message: "permitValue must be representable as bigint" } };
    }
    if (permitValueBig <= BigInt(0)) {
      return { ok: false, error: { code: "invalid_body", message: "permitValue must be positive" } };
    }
    normalizedV = normalizePermitV(v);
    rHex = r as `0x${string}`;
    sHex = s as `0x${string}`;
  }

  // Permit2 fields — validated when not in 2612 mode.
  let permit2NonceBig: bigint | null = null;
  let permit2SignatureHex: `0x${string}` | null = null;
  if (hasPermit2) {
    if (typeof permit2Nonce !== "string" && typeof permit2Nonce !== "number") {
      return { ok: false, error: { code: "invalid_body", message: "permit2Nonce must be a string or number" } };
    }
    try {
      permit2NonceBig = BigInt(permit2Nonce as string | number);
    } catch {
      return { ok: false, error: { code: "invalid_body", message: "permit2Nonce must be representable as bigint" } };
    }
    if (permit2NonceBig < BigInt(0)) {
      return { ok: false, error: { code: "invalid_body", message: "permit2Nonce must be non-negative" } };
    }
    if (typeof permit2Signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(permit2Signature)) {
      return {
        ok: false,
        error: {
          code: "invalid_body",
          message: "permit2Signature must be a 0x-prefixed hex string",
        },
      };
    }
    permit2SignatureHex = permit2Signature as `0x${string}`;
  }

  // Validate networkKey against the registry
  if (typeof networkKey !== "string") {
    return {
      ok: false,
      error: { code: "invalid_body", message: "networkKey must be a string" },
    };
  }
  try {
    assertValidNetworkKey(networkKey);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "invalid_body",
        message: err instanceof Error ? err.message : "Unknown networkKey",
      },
    };
  }

  // Validate tokenSymbol against the registry for the given network
  if (typeof tokenSymbol !== "string") {
    return {
      ok: false,
      error: { code: "invalid_body", message: "tokenSymbol must be a string" },
    };
  }
  try {
    const network = NETWORKS[networkKey as NetworkKey];
    assertValidTokenSymbol(network, tokenSymbol);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "invalid_body",
        message: err instanceof Error ? err.message : "Unknown tokenSymbol",
      },
    };
  }

  return {
    ok: true,
    value: {
      buyer: buyer as `0x${string}`,
      deadline: deadlineBig,
      v: normalizedV,
      r: rHex,
      s: sHex,
      permitValue: permitValueBig,
      permit2Nonce: permit2NonceBig,
      permit2Signature: permit2SignatureHex,
      intentSignature: intentSignature as `0x${string}`,
      networkKey: networkKey,
      tokenSymbol: tokenSymbol,
    },
  };
}

export interface SessionSnapshot {
  status: string;
  expiresAt: Date;
  paymentId: string | null;
  subscriptionId: string | null;
}

export function validateSessionForRelay(
  session: SessionSnapshot | null,
  now: Date = new Date(),
): { ok: true } | { ok: false; error: ValidationError } {
  if (!session) {
    return { ok: false, error: { code: "session_not_found" } };
  }
  if (session.expiresAt < now) {
    return { ok: false, error: { code: "session_expired" } };
  }
  if (session.status !== "active" && session.status !== "viewed") {
    return { ok: false, error: { code: "session_not_payable", status: session.status } };
  }
  if (session.paymentId !== null || session.subscriptionId !== null) {
    return { ok: false, error: { code: "session_already_relayed" } };
  }
  return { ok: true };
}

export function validateDeadline(
  deadline: bigint,
  maxWindowSeconds?: number | Date,
  now?: Date,
): { ok: true } | { ok: false; error: ValidationError } {
  // Handle overloads: validateDeadline(deadline) or validateDeadline(deadline, maxWindowSeconds) or validateDeadline(deadline, now) for backward compat
  let actualMaxWindowSeconds = 60 * 60;
  let actualNow = new Date();

  if (maxWindowSeconds !== undefined) {
    if (maxWindowSeconds instanceof Date) {
      // Old signature: validateDeadline(deadline, now)
      actualNow = maxWindowSeconds;
    } else {
      // New signature: validateDeadline(deadline, maxWindowSeconds, now?)
      actualMaxWindowSeconds = maxWindowSeconds;
      if (now !== undefined) {
        actualNow = now;
      }
    }
  }

  const nowSeconds = BigInt(Math.floor(actualNow.getTime() / 1000));
  if (deadline <= nowSeconds) {
    return { ok: false, error: { code: "deadline_passed" } };
  }
  if (deadline - nowSeconds > BigInt(actualMaxWindowSeconds)) {
    return { ok: false, error: { code: "deadline_passed" } };
  }
  return { ok: true };
}
