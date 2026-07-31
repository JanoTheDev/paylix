import { NextRequest, NextResponse } from "next/server";

const PAYLIX_API_VERSION = "2026-04-12";

const SESSION_COOKIE = "better-auth.session_token";
const SECURE_SESSION_COOKIE = "__Secure-better-auth.session_token";

const STATE_CHANGING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Buyer-facing endpoints that are legitimately called cross-origin from an
 * embedded checkout / portal. They are cookie-less by design — authorization
 * there comes from the session id or a signed portal token, never from the
 * dashboard session cookie — so the CSRF check does not apply.
 */
const CSRF_EXEMPT_PREFIXES = ["/api/checkout", "/api/portal", "/api/public"];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has(SESSION_COOKIE) ||
    request.cookies.has(SECURE_SESSION_COOKIE)
  );
}

/**
 * Cross-site request forgery check for cookie-authenticated requests.
 *
 * Fails closed: a state-changing request that carries the dashboard session
 * cookie must prove same-origin intent via `Origin` or `Sec-Fetch-Site`.
 * Previously a request with no `Origin` header was let through, which any
 * non-browser client could trivially arrange.
 *
 * Requests authenticated by an API key (`Authorization: Bearer sk_...`) are
 * not cookie-authenticated and therefore not forgeable from a victim's
 * browser — server-to-server SDK callers send no `Origin` and must not be
 * blocked.
 */
/**
 * Hostnames that count as "this site".
 *
 * Comparing against `request.nextUrl.origin` alone breaks behind a
 * TLS-terminating proxy that doesn't set `X-Forwarded-Proto`/`-Host`: the app
 * sees `http://internal-host:3000` while the browser sends
 * `https://app.example.com`, so every dashboard POST would 403. Compare
 * hostnames (scheme and port are not what CSRF turns on) and accept the
 * forwarded/Host header and the configured public URL.
 *
 * `Host` / `X-Forwarded-Host` are only reachable from a real browser via the
 * address bar, and a cross-site attacker cannot set `Origin` — so widening
 * the accepted-host set does not weaken the check.
 */
function sameSiteHostnames(request: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const first = value.split(",")[0]?.trim();
    if (!first) return;
    try {
      const url = first.includes("://") ? new URL(first) : new URL(`http://${first}`);
      if (url.hostname) hosts.add(url.hostname.toLowerCase());
    } catch {
      /* ignore malformed header */
    }
  };

  add(request.nextUrl.hostname);
  add(request.headers.get("x-forwarded-host"));
  add(request.headers.get("host"));
  add(process.env.BETTER_AUTH_URL);
  add(process.env.NEXT_PUBLIC_APP_URL);
  return hosts;
}

function isSameSite(request: NextRequest, candidate: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(candidate).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  return sameSiteHostnames(request).has(hostname);
}

function isCsrfRejected(request: NextRequest): boolean {
  if (!STATE_CHANGING.has(request.method)) return false;

  const path = request.nextUrl.pathname;
  if (CSRF_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return false;

  // API-key auth: no ambient credential, nothing to forge.
  if (request.headers.get("authorization")) return false;

  // No session cookie: the request cannot act as a logged-in user.
  if (!hasSessionCookie(request)) return false;

  const origin = request.headers.get("origin");
  if (origin) return !isSameSite(request, origin);

  // No Origin header. Modern browsers always send it on state-changing
  // fetches, but accept an explicit same-origin Sec-Fetch-Site as proof.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "none") return false;

  const referer = request.headers.get("referer");
  if (referer) return !isSameSite(request, referer);

  return true;
}

function csrfResponse(): NextResponse {
  const res = NextResponse.json(
    {
      error: {
        code: "csrf_rejected",
        message: "Cross-origin request blocked",
      },
    },
    { status: 403 },
  );
  res.headers.set("x-paylix-version", PAYLIX_API_VERSION);
  return res;
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (isCsrfRejected(request)) {
    return csrfResponse();
  }

  // API routes: attach the version header, but skip the session redirect —
  // API auth is per-route (session, API key, or signed portal token).
  if (path.startsWith("/api/")) {
    const response = NextResponse.next();
    response.headers.set("x-paylix-version", PAYLIX_API_VERSION);
    return response;
  }

  // Dashboard pages require a session cookie.
  if (!hasSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/overview/:path*",
    "/products/:path*",
    "/payments/:path*",
    "/subscribers/:path*",
    "/customers/:path*",
    "/invoices/:path*",
    "/api-keys/:path*",
    "/webhooks/:path*",
    "/settings/:path*",
  ],
};
