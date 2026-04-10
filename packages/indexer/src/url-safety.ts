import { lookup } from "dns/promises";

const BLOCKED_CIDRS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^::1$/,
  /^fe80::/i,
  /^fc00::/i,
  /^fd00::/i,
];

function isBlockedIp(ip: string): boolean {
  return BLOCKED_CIDRS.some((re) => re.test(ip));
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

  try {
    const { address } = await lookup(hostname);
    if (isBlockedIp(address)) {
      return isProd ? "Private/internal IPs not allowed" : null;
    }
  } catch {
    return "Could not resolve hostname";
  }

  return null;
}
