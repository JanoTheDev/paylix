import { lookup } from "dns/promises";

/**
 * SSRF guard for merchant-supplied webhook URLs.
 *
 * Registration-time validation alone is not enough: DNS can be re-pointed
 * after the fact (rebinding) and a public host can 302 to a link-local
 * address. `validateWebhookUrl` is therefore also called immediately before
 * every send, and the delivery fetch must use `redirect: "manual"` so a 3xx
 * is a failure rather than a second, unvalidated request.
 *
 * KNOWN LIMITATION (not closed here) — resolve/connect TOCTOU. We resolve the
 * hostname, then `fetch()` resolves it again independently; a DNS record with
 * a ~0s TTL can answer public on the first lookup and 169.254.169.254 on the
 * second. Re-validating per send shrinks the window from "forever" to "one
 * request", but does not eliminate it. Closing it properly requires pinning
 * the checked address at connect time — a custom `undici` Agent whose
 * `connect.lookup` returns only the address we validated, or an egress proxy
 * / network policy that blocks link-local and RFC1918 at the host level.
 * That is the recommended production control; this module is defence in depth.
 */

/** Reserved/private IPv4 ranges expressed as [network, prefixLength]. */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // RFC6598 CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const addr = parseIpv4(ip);
  if (addr === null) return true; // unparseable → deny
  return BLOCKED_V4.some(([network, bits]) => {
    const base = parseIpv4(network);
    if (base === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (addr & mask) >>> 0 === (base & mask) >>> 0;
  });
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0]; // strip zone id

  // IPv4-mapped / IPv4-compatible forms (::ffff:169.254.169.254) must be
  // evaluated with the IPv4 rules, not treated as an opaque v6 address.
  const mapped = normalized.match(/^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (normalized === "::" || normalized === "::1") return true; // unspecified, loopback
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique-local
  if (/^ff[0-9a-f]{2}:/.test(normalized)) return true; // ff00::/8 multicast
  if (/^(2001:0?db8|64:ff9b|100:)/.test(normalized)) return true; // doc / NAT64 / discard
  return false;
}

/** True when the address must never be contacted from the server. */
export function isBlockedIp(ip: string, family?: number): boolean {
  if (!ip) return true;
  if (family === 6 || ip.includes(":")) return isBlockedIpv6(ip);
  return isBlockedIpv4(ip);
}

/**
 * Resolve a hostname and reject if ANY returned address is private. Checking
 * only the first A record lets a host with one public and one internal
 * address slip through, and the OS may return them in any order.
 */
async function resolvesToBlockedIp(hostname: string): Promise<boolean | "unresolvable"> {
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return "unresolvable";
    return addresses.some((a) => isBlockedIp(a.address, a.family));
  } catch {
    return "unresolvable";
  }
}

/**
 * Returns an error message when the URL is unsafe, or `null` when it is
 * acceptable. Outside production the private-range rules are relaxed so
 * local development against `localhost` webhooks still works; everything
 * else (scheme, credentials, resolvability) is enforced in every environment.
 */
export async function validateWebhookUrl(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  const isProd = process.env.NODE_ENV === "production";

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Only http/https allowed";
  }
  if (parsed.protocol !== "https:" && isProd) {
    return "HTTPS required";
  }
  // Credentials in the URL get replayed to whatever the request lands on and
  // are a common way to smuggle a host past naive parsers.
  if (parsed.username || parsed.password) {
    return "Credentials in webhook URL are not allowed";
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) return "Invalid URL";

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return isProd ? "localhost not allowed" : null;
  }

  const blocked = await resolvesToBlockedIp(hostname);
  if (blocked === "unresolvable") return "Could not resolve hostname";
  if (blocked) {
    return isProd ? "Private/internal IPs not allowed" : null;
  }

  return null; // safe
}
