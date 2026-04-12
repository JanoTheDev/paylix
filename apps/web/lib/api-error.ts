import { NextResponse } from "next/server";

export function apiError(
  code: string,
  message: string,
  status: number = 400,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
