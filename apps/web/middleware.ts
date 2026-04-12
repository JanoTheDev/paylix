import { NextRequest, NextResponse } from "next/server";

const PAYLIX_API_VERSION = "2026-04-12";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // API routes: attach version header and run CSRF check, but skip session auth
  if (path.startsWith("/api/")) {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      const origin = request.headers.get("origin");
      const isExempt =
        path.startsWith("/api/checkout") || path.startsWith("/api/portal");

      if (!isExempt && origin && origin !== request.nextUrl.origin) {
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
    }

    const response = NextResponse.next();
    response.headers.set("x-paylix-version", PAYLIX_API_VERSION);
    return response;
  }

  // Dashboard routes: CSRF check + session auth
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const isExempt =
      path.startsWith("/api/checkout") || path.startsWith("/api/portal");

    if (!isExempt && origin && origin !== request.nextUrl.origin) {
      return NextResponse.json(
        {
          error: {
            code: "csrf_rejected",
            message: "Cross-origin request blocked",
          },
        },
        { status: 403 },
      );
    }
  }

  const sessionCookie = request.cookies.get("better-auth.session_token");
  if (!sessionCookie) {
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
