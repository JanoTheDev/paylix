import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  // CSRF check: block cross-origin mutating requests on cookie-authenticated routes
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const path = request.nextUrl.pathname;
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
