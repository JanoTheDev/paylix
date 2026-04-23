import { db } from "@/lib/db";
import {
  users,
  merchantPayoutWallets,
  merchantProfiles,
  NOTIFICATION_KINDS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  getAvailableNetworks,
  assertValidNetworkKey,
} from "@paylix/config/networks";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode, session } = ctx;

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      walletAddress: users.walletAddress,
      checkoutFieldDefaults: users.checkoutFieldDefaults,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) {
    return NextResponse.json({ error: { code: "not_found", message: "User not found" } }, { status: 404 });
  }

  // Normalize jsonb shape so the client can rely on all four keys being present.
  const defaults = {
    firstName: user.checkoutFieldDefaults?.firstName ?? false,
    lastName: user.checkoutFieldDefaults?.lastName ?? false,
    email: user.checkoutFieldDefaults?.email ?? false,
    phone: user.checkoutFieldDefaults?.phone ?? false,
  };

  // Load all payout wallet rows for this org
  const walletRows = await db
    .select()
    .from(merchantPayoutWallets)
    .where(eq(merchantPayoutWallets.organizationId, organizationId));

  let [profile] = await db
    .select()
    .from(merchantProfiles)
    .where(eq(merchantProfiles.organizationId, organizationId))
    .limit(1);

  if (!profile) {
    const [created] = await db
      .insert(merchantProfiles)
      .values({ organizationId })
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

  const notificationsEnabled = profile.notificationsEnabled;
  const notificationPreferences: NotificationPreferences = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(profile.notificationPreferences ?? {}),
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
      xpub: row?.xpub ?? null,
    };
  });

  // session is used here only to satisfy TS — avoid the `session!` cast
  void session;

  return NextResponse.json({
    ...user,
    livemode,
    checkoutFieldDefaults: defaults,
    networks,
    businessProfile,
    notificationsEnabled,
    notificationPreferences,
  });
}

export async function PATCH(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId } = ctx;

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
        { error: { code: "invalid_wallet", message: "Invalid wallet address. Must start with 0x and be 42 characters." } },
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
          { error: { code: "invalid_request", message: "Invalid network entry" } },
          { status: 400 },
        );
      }
      try {
        assertValidNetworkKey(entry.networkKey);
      } catch (err) {
        return NextResponse.json(
          { error: { code: "invalid_network_key", message: err instanceof Error ? err.message : "Unknown networkKey" } },
          { status: 400 },
        );
      }

      // Validate the payout address per chain family:
      //   EVM     — 0x-prefixed 20-byte hex
      //   Solana  — base58 pubkey (32-44 chars, base58 alphabet)
      //   UTXO    — xpub stored separately; overrideAddress is ignored
      const isSolana =
        entry.networkKey === "solana" || entry.networkKey === "solana-devnet";
      const isUtxo =
        entry.networkKey === "bitcoin" ||
        entry.networkKey === "bitcoin-testnet" ||
        entry.networkKey === "litecoin" ||
        entry.networkKey === "litecoin-testnet";

      const addr = isUtxo ? null : entry.overrideAddress;
      const xpub = isUtxo ? (typeof entry.xpub === "string" ? entry.xpub : null) : null;

      if (
        !isUtxo &&
        addr !== null &&
        addr !== undefined &&
        addr !== ""
      ) {
        const okEvm = /^0x[a-fA-F0-9]{40}$/.test(addr);
        const okSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
        const ok = isSolana ? okSolana : okEvm;
        if (!ok) {
          return NextResponse.json(
            {
              error: {
                code: "invalid_wallet",
                message: `Invalid override address for ${entry.networkKey}. Expected ${isSolana ? "a base58 pubkey" : "a 0x-prefixed Ethereum address"}.`,
              },
            },
            { status: 400 },
          );
        }
      }

      if (isUtxo && xpub && xpub.length < 100) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_xpub",
              message: `Invalid xpub for ${entry.networkKey}. Expected an extended public key (xpub / zpub / Ltub / tpub / ...).`,
            },
          },
          { status: 400 },
        );
      }

      await db
        .insert(merchantPayoutWallets)
        .values({
          organizationId,
          networkKey: entry.networkKey,
          enabled: entry.enabled,
          walletAddress: addr || null,
          xpub: xpub || null,
        })
        .onConflictDoUpdate({
          target: [
            merchantPayoutWallets.organizationId,
            merchantPayoutWallets.networkKey,
          ],
          set: {
            enabled: entry.enabled,
            walletAddress: addr || null,
            xpub: xpub || null,
          },
        });
    }
  }

  if (body.businessProfile && typeof body.businessProfile === "object") {
    const bp = body.businessProfile;
    await db
      .insert(merchantProfiles)
      .values({
        organizationId,
        legalName: String(bp.legalName ?? ""),
        addressLine1: String(bp.addressLine1 ?? ""),
        addressLine2: bp.addressLine2 ?? null,
        city: String(bp.city ?? ""),
        postalCode: String(bp.postalCode ?? ""),
        country: String(bp.country ?? "").toUpperCase(),
        taxId: bp.taxId ?? null,
        supportEmail: String(bp.supportEmail ?? ""),
        logoUrl: bp.logoUrl ?? null,
        invoicePrefix: String(bp.invoicePrefix ?? "INV-"),
        invoiceFooter: bp.invoiceFooter ?? null,
      })
      .onConflictDoUpdate({
        target: merchantProfiles.organizationId,
        set: {
          legalName: String(bp.legalName ?? ""),
          addressLine1: String(bp.addressLine1 ?? ""),
          addressLine2: bp.addressLine2 ?? null,
          city: String(bp.city ?? ""),
          postalCode: String(bp.postalCode ?? ""),
          country: String(bp.country ?? "").toUpperCase(),
          taxId: bp.taxId ?? null,
          supportEmail: String(bp.supportEmail ?? ""),
          logoUrl: bp.logoUrl ?? null,
          invoicePrefix: String(bp.invoicePrefix ?? "INV-"),
          invoiceFooter: bp.invoiceFooter ?? null,
          updatedAt: new Date(),
        },
      });
  }

  if (typeof body.notificationsEnabled === "boolean") {
    await db
      .insert(merchantProfiles)
      .values({
        organizationId,
        notificationsEnabled: body.notificationsEnabled,
      })
      .onConflictDoUpdate({
        target: merchantProfiles.organizationId,
        set: {
          notificationsEnabled: body.notificationsEnabled,
          updatedAt: new Date(),
        },
      });
  }

  if (
    body.notificationPreferences &&
    typeof body.notificationPreferences === "object"
  ) {
    const incoming = body.notificationPreferences as Record<string, unknown>;

    // Load existing row so we can merge partial updates on top of whatever
    // the merchant has stored today (preserves kinds not in the payload).
    const [existing] = await db
      .select({ preferences: merchantProfiles.notificationPreferences })
      .from(merchantProfiles)
      .where(eq(merchantProfiles.organizationId, organizationId))
      .limit(1);

    const merged: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(existing?.preferences ?? {}),
    };
    for (const kind of NOTIFICATION_KINDS) {
      if (typeof incoming[kind] === "boolean") {
        merged[kind] = incoming[kind] as boolean;
      }
    }

    await db
      .insert(merchantProfiles)
      .values({
        organizationId,
        notificationPreferences: merged,
      })
      .onConflictDoUpdate({
        target: merchantProfiles.organizationId,
        set: {
          notificationPreferences: merged,
          updatedAt: new Date(),
        },
      });
  }

  // If only networks/businessProfile/notifications were updated,
  // skip the users table update
  if (Object.keys(updates).length === 0) {
    if (
      Array.isArray(body.networks) ||
      body.businessProfile ||
      typeof body.notificationsEnabled === "boolean" ||
      body.notificationPreferences
    ) {
      void recordAudit({
        organizationId,
        userId,
        action: "settings.updated",
        resourceType: "settings",
        details: {
          networks: Array.isArray(body.networks),
          businessProfile: !!body.businessProfile,
          notificationsEnabled:
            typeof body.notificationsEnabled === "boolean"
              ? body.notificationsEnabled
              : undefined,
          notificationPreferences: body.notificationPreferences ?? undefined,
        },
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: { code: "invalid_request", message: "No valid fields to update" } }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      walletAddress: users.walletAddress,
      checkoutFieldDefaults: users.checkoutFieldDefaults,
    });

  void recordAudit({
    organizationId,
    userId,
    action: "settings.updated",
    resourceType: "settings",
    details: { fields: Object.keys(updates) },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json(updated);
}
