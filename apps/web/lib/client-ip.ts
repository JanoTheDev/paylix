/**
 * Trustworthy client IP extraction.
 *
 * `x-forwarded-for` is append-only: each proxy adds the address it received
 * the connection from, so the LEFTMOST entry is whatever the client sent and
 * is fully attacker-controlled. Taking `split(",")[0]` — as 12 audit call
 * sites and the relay rate limiter did — lets `X-Forwarded-For: <random>`
 * defeat a per-IP rate limit on every request and poisons `audit_logs.ip_address`.
 *
 * The only entries we can trust are the ones our own infrastructure appended,
 * counted from the RIGHT. `TRUSTED_PROXY_HOPS` is the number of proxies in
 * front of the app (0 when nothing is in front, 1 behind a single load
 * balancer / CDN, and so on).
 */

const MAX_HEADER_LENGTH = 1024;

function trustedHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === "") return 1; // default: one reverse proxy / CDN
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 16) return 1;
  return n;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every(
    (p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && (p === "0" || !p.startsWith("0")),
  );
}

function isIpv6(value: string): boolean {
  if (!value.includes(":") || value.length > 45) return false;
  // Groups of 1-4 hex digits, at most one "::" run, optional trailing v4 part.
  if (!/^[0-9a-f:.]+$/i.test(value)) return false;
  if ((value.match(/::/g) ?? []).length > 1) return false;
  const tail = value.split(":").pop() ?? "";
  const head = tail.includes(".") ? value.slice(0, value.length - tail.length - 1) : value;
  if (tail.includes(".") && !isIpv4(tail)) return false;
  return head
    .split(":")
    .every((g) => g === "" || /^[0-9a-f]{1,4}$/i.test(g));
}

/**
 * Reduce a header entry to a bare IP literal, or `null`.
 *
 * Shape is validated, not just trimmed: an unvalidated value becomes a
 * rate-limit bucket key, so a 2 KB junk `X-Forwarded-For` would otherwise
 * mint a fresh bucket (and a fresh audit-log row) per request.
 */
function normalize(ip: string): string | null {
  if (ip.length > MAX_HEADER_LENGTH) return null;
  const trimmed = ip.trim().replace(/^\[|\]$/g, "").replace(/\]:\d+$/, "");
  if (!trimmed) return null;
  // Strip an IPv4 port suffix ("1.2.3.4:5678"); a bare IPv6 keeps its colons.
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed);
  let candidate = v4WithPort ? v4WithPort[1] : trimmed;
  // ::ffff:1.2.3.4 → 1.2.3.4
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
  if (mapped) candidate = mapped[1];
  candidate = candidate.split("%")[0]; // drop an IPv6 zone id
  if (isIpv4(candidate) || isIpv6(candidate)) return candidate;
  return null;
}

/**
 * Best-effort client IP for rate limiting and audit records.
 * Returns `"unknown"` when nothing trustworthy is available — callers should
 * treat that as a single shared bucket rather than as a unique client.
 */
export function getClientIp(request: Request): string {
  const hops = trustedHops();

  // TRUSTED_PROXY_HOPS=0 means nothing sits in front of this process, so the
  // ENTIRE forwarding chain — including its rightmost entry and every
  // `cf-connecting-ip` / `x-real-ip` / `true-client-ip` header — is supplied
  // by the client and equally forgeable. Trusting any of it would hand the
  // caller a fresh rate-limit bucket per request and poison
  // `audit_logs.ip_address`, which is the exact bug API-34 is about.
  if (hops === 0) return "unknown";

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Only the rightmost `hops` entries can ever be selected, so bound the
    // work regardless of how long a chain the client pads the header with.
    const chain = forwarded
      .split(",")
      .slice(-(hops + 16))
      .map(normalize)
      .filter((v): v is string => v !== null);
    if (chain.length > 0) {
      // Count from the right: the last entry was appended by the proxy
      // closest to us. With N trusted hops, the client is N entries in.
      const index = Math.max(0, chain.length - 1 - Math.max(0, hops - 1));
      return chain[index] ?? "unknown";
    }
  }

  // Platform-provided single-value headers are set by the edge, not the client.
  for (const header of ["cf-connecting-ip", "x-real-ip", "true-client-ip"]) {
    const value = request.headers.get(header);
    const ip = value ? normalize(value) : null;
    if (ip) return ip;
  }

  return "unknown";
}
