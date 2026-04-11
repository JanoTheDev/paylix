import { randomBytes } from "crypto";

export function generateHostedToken(): string {
  // 24 random bytes → 32 base64url chars (no padding). Unguessable.
  return randomBytes(24)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
