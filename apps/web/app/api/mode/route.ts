import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { MODE_COOKIE_NAME } from "@/lib/request-mode";

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const mode = (body as { mode?: unknown }).mode;
  if (mode !== "test" && mode !== "live") {
    return NextResponse.json(
      { error: { code: "invalid_mode", message: "mode must be 'test' or 'live'" } },
      { status: 400 },
    );
  }

  const store = await cookies();
  store.set(MODE_COOKIE_NAME, mode, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({ success: true, mode });
}
