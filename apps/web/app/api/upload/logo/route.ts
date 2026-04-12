import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { randomBytes } from "crypto";
import path from "path";

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);
const MAX_BYTES = 512 * 1024;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: "missing_file", message: "No file provided" } }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: { code: "unsupported_file_type", message: "Unsupported file type" } },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: { code: "file_too_large", message: "File too large (max 512KB)" } },
      { status: 413 },
    );
  }
  const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1];
  const name = `${session.user.id}-${randomBytes(6).toString("hex")}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads", "logos");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ url: `/uploads/logos/${name}` });
}
