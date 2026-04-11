import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  users,
  merchantPayoutWallets,
  merchantProfiles,
} from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  getAvailableNetworks,
  assertValidNetworkKey,
} from "@paylix/config/networks";

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
      checkoutFieldDefaults: users.checkoutFieldDefaults,
    })
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Normalize jsonb shape so the client can rely on all four keys being present.
  const defaults = {
    firstName: user.checkoutFieldDefaults?.firstName ?? false,
    lastName: user.checkoutFieldDefaults?.lastName ?? false,
    email: user.checkoutFieldDefaults?.email ?? false,
    phone: user.checkoutFieldDefaults?.phone ?? false,
  };

  // Load all payout wallet rows for this merchant
  const walletRows = await db
    .select()
    .from(merchantPayoutWallets)
    .where(eq(merchantPayoutWallets.userId, session.user.id));

  let [profile] = await db
    .select()
    .from(merchantProfiles)
    .where(eq(merchantProfiles.userId, session.user.id))
    .limit(1);

  if (!profile) {
    const [created] = await db
      .insert(merchantProfiles)
      .values({ userId: session.user.id })
      .returning();
    profile = created;
  }

  const businessProfile = {
    legalName: profile.legalName,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    postalCode: profile.postalCode,
    country: profile.country,
    taxId: profile.taxId,
    supportEmail: profile.supportEmail,
    logoUrl: profile.logoUrl,
    invoicePrefix: profile.invoicePrefix,
    invoiceFooter: profile.invoiceFooter,
  };

  // Build the response: every available network gets an entry, with defaults
  // if there's no row yet
  const available = getAvailableNetworks();
  const walletRowsByKey = new Map(
    walletRows.map((r) => [r.networkKey, r]),
  );
  const networks = available.map((n) => {
    const row = walletRowsByKey.get(n.key);
    return {
      networkKey: n.key,
      chainName: n.chainName,
      displayLabel: n.displayLabel,
      enabled: row?.enabled ?? false,
      usesDefault: row ? row.walletAddress === null : true,
      overrideAddress: row?.walletAddress ?? null,
    };
  });

  return NextResponse.json({
    ...user,
    checkoutFieldDefaults: defaults,
    networks,
    businessProfile,
  });
}

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const updates: Partial<{
    name: string;
    walletAddress: string;
    checkoutFieldDefaults: {
      firstName: boolean;
      lastName: boolean;
      email: boolean;
      phone: boolean;
    };
  }> = {};

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

  if (body.checkoutFieldDefaults && typeof body.checkoutFieldDefaults === "object") {
    const f = body.checkoutFieldDefaults;
    updates.checkoutFieldDefaults = {
      firstName: Boolean(f.firstName),
      lastName: Boolean(f.lastName),
      email: Boolean(f.email),
      phone: Boolean(f.phone),
    };
  }

  if (Array.isArray(body.networks)) {
    for (const entry of body.networks) {
      if (
        typeof entry.networkKey !== "string" ||
        typeof entry.enabled !== "boolean"
      ) {
        return NextResponse.json(
          { error: "Invalid network entry" },
          { status: 400 },
        );
      }
      try {
        assertValidNetworkKey(entry.networkKey);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Unknown networkKey" },
          { status: 400 },
        );
      }

      const addr = entry.overrideAddress;
      if (
        addr !== null &&
        addr !== undefined &&
        addr !== "" &&
        !/^0x[a-fA-F0-9]{40}$/.test(addr)
      ) {
        return NextResponse.json(
          { error: `Invalid override address for ${entry.networkKey}` },
          { status: 400 },
        );
      }

      await db
        .insert(merchantPayoutWallets)
        .values({
          userId: session.user.id,
          networkKey: entry.networkKey,
          enabled: entry.enabled,
          walletAddress: addr || null,
        })
        .onConflictDoUpdate({
          target: [
            merchantPayoutWallets.userId,
            merchantPayoutWallets.networkKey,
          ],
          set: {
            enabled: entry.enabled,
            walletAddress: addr || null,
          },
        });
    }
  }

  // If only networks were updated, skip the users table update
  if (Object.keys(updates).length === 0) {
    if (Array.isArray(body.networks)) {
      return NextResponse.json({ success: true });
    }
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
      checkoutFieldDefaults: users.checkoutFieldDefaults,
    });

  return NextResponse.json(updated);
}
