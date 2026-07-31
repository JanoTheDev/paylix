import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { randomBytes } from "crypto";
import path from "path";
import { apiError } from "@/lib/api-error";
import { checkRateLimitAsync } from "@/lib/rate-limit";

/**
 * Merchant logo upload.
 *
 * `image/svg+xml` is deliberately NOT accepted. SVG is an active document
 * format: a file containing `<script>` executes with this app's origin when
 * loaded directly from `/uploads/logos/...`, and the resulting URL is stored
 * on `merchantProfiles.logoUrl` and rendered on invoices — stored XSS.
 * Re-enabling it requires either DOMPurify sanitisation or serving uploads
 * from a separate origin with `Content-Disposition: attachment`.
 *
 * The extension is chosen from sniffed magic bytes, not from `file.type` —
 * that header is supplied by the client's multipart body and is attacker-
 * controlled.
 */

const MAX_BYTES = 512 * 1024;

type RasterFormat = { ext: "png" | "jpg" | "webp"; mime: string };

/** Content sniffing. Returns null for anything not a supported raster image. */
function sniffFormat(bytes: Uint8Array): RasterFormat | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }
  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return apiError("unauthorized", "Authentication required", 401);
  }

  // Per-user limit: without one, any authenticated user could fill the disk
  // 512 KB at a time.
  const rl = await checkRateLimitAsync(`upload-logo:${session.user.id}`, 10, 60_000);
  if (!rl.ok) {
    const retryAfter = String(Math.ceil((rl.retryAfterMs ?? 0) / 1000));
    return NextResponse.json(
      {
        error: {
          code: "rate_limited",
          message: `Too many uploads. Retry in ${retryAfter}s`,
        },
      },
      { status: 429, headers: { "Retry-After": retryAfter } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("invalid_body", "Expected a multipart/form-data body", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError("missing_file", "No file provided", 400);
  }
  if (file.size > MAX_BYTES) {
    return apiError("file_too_large", "File too large (max 512KB)", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) {
    return apiError("file_too_large", "File too large (max 512KB)", 413);
  }

  const format = sniffFormat(bytes);
  if (!format) {
    return apiError(
      "unsupported_file_type",
      "Unsupported file type. Upload a PNG, JPEG or WebP image.",
      415,
    );
  }

  // Never interpolate an id into a path without stripping separators.
  const safeUserId = session.user.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  const name = `${safeUserId}-${randomBytes(6).toString("hex")}.${format.ext}`;
  const dir = path.join(process.cwd(), "public", "uploads", "logos");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return NextResponse.json({ url: `/uploads/logos/${name}`, contentType: format.mime });
}
