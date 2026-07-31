/**
 * Client IP extraction that isn't trivially spoofable.
 *
 * `x-forwarded-for` is a list the client can seed, so the *leftmost* entry —
 * which 12 call sites used — is attacker-controlled. `getClientIp` counts in
 * from the right using `TRUSTED_PROXY_HOPS`.
 */

import { getClientIp } from "@/lib/client-ip";

/** Rate-limit bucket. Never empty; falls back to `"unknown"`. */
export const clientIpKey = getClientIp;

/** Audit-log form: `null` rather than the `"unknown"` sentinel. */
export function clientIp(request: Request): string | null {
  const ip = getClientIp(request);
  return ip === "unknown" ? null : ip;
}
