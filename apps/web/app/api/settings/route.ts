import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      walletAddress: users.walletAddress,
    })
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const updates: Partial<{ name: string; walletAddress: string }> = {};

  if (typeof body.name === "string" && body.name.trim().length > 0) {
    updates.name = body.name.trim();
  }

  if (typeof body.walletAddress === "string") {
    const addr = body.walletAddress.trim();
    if (addr === "") {
      updates.walletAddress = "";
    } else if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      return NextResponse.json(
        { error: "Invalid wallet address. Must start with 0x and be 42 characters." },
        { status: 400 }
      );
    } else {
      updates.walletAddress = addr;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, session.user.id))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      walletAddress: users.walletAddress,
    });

  return NextResponse.json(updated);
}
