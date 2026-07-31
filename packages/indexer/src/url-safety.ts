import { lookup } from "dns/promises";

const BLOCKED_CIDRS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  // CGNAT 100.64.0.0/10 — routable inside many hosting providers.
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  // 192.0.0.0/24 — IETF protocol assignments (incl. NAT64 well-known prefix).
  /^192\.0\.0\./,
  /^::1$/,
  /^fe80::/i,
  // Unique-local fc00::/7 covers both fc00:: and fd00::.
  /^f[cd][0-9a-f]{2}:/i,
];

/**
 * `::ffff:127.0.0.1` and `::FFFF:7F00:1` are 127.0.0.1 as far as the socket is
 * concerned, but neither matches an IPv4 blocklist entry. Normalize the
 * dotted-quad form before matching so the mapped address is caught.
 */
function normalizeIp(ip: string): string {
  const withoutZone = ip.split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(withoutZone);
  return mapped ? mapped[1] : withoutZone;
}

function isBlockedIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  return BLOCKED_CIDRS.some((re) => re.test(normalized));
}

export async function validateWebhookUrl(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    return "HTTPS required";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Only http/https allowed";
  }

  const hostname = parsed.hostname.toLowerCase();
  const isProd = process.env.NODE_ENV === "production";

  if (hostname === "localhost") {
    return isProd ? "localhost not allowed" : null;
  }

  // Bracketed IPv6 literals arrive as "[::1]" in URL.hostname.
  const literal = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (isBlockedIp(literal)) {
    return isProd ? "Private/internal IPs not allowed" : null;
  }

  try {
    // Resolve EVERY address, not just the first: a host publishing both a
    // public and a private record would otherwise pass on the public one and
    // connect to the private one.
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return "Could not resolve hostname";
    if (addresses.some((a) => isBlockedIp(a.address))) {
      return isProd ? "Private/internal IPs not allowed" : null;
    }
  } catch {
    return "Could not resolve hostname";
  }

  // NOTE: validation and delivery resolve the hostname independently, so a
  // rebinding DNS record can still point the actual fetch at a blocked address.
  // Closing that requires pinning the validated IP into the request via a
  // custom agent/lookup — see IDX-38 in audit/03-indexers.md.
  return null;
}
