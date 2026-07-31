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
import { z } from "zod";
import { clientIp } from "../_shared/client-ip";
import { readJsonBody, parseWith } from "../_shared/http";
import { requireRole } from "../_shared/roles";
import {
  isUtxoNetwork,
  UTXO_MERCHANT_NOTICE,
  UTXO_PAYMENTS_ENABLED,
} from "@/app/_lib/utxo-payments";

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

// A trimmed, non-empty string capped at `max`. Empty strings collapse to
// undefined so a blank form field is "leave alone", not "store the empty
// string" (which is what `String(bp.legalName ?? "")` used to do — and
// `{"legalName":{}}` stored the literal "[object Object]").
const bounded = (max: number) => z.string().trim().max(max);

// `logoUrl` is rendered on invoices, so it must be an https URL or a
// relative path into our own uploads directory — never `javascript:` or a
// data: document.
const logoUrlSchema = bounded(2048).refine(
  (v) => v === "" || v.startsWith("/uploads/") || /^https:\/\//i.test(v),
  "logoUrl must be an https URL or an uploaded /uploads/... path",
);

const settingsSchema = z.object({
  name: bounded(200).min(1).optional(),
  walletAddress: bounded(64).optional(),
  checkoutFieldDefaults: z
    .object({
      firstName: z.boolean().optional(),
      lastName: z.boolean().optional(),
      email: z.boolean().optional(),
      phone: z.boolean().optional(),
    })
    .optional(),
  networks: z
    .array(
      z.object({
        networkKey: bounded(64).min(1),
        enabled: z.boolean(),
        overrideAddress: bounded(128).nullish(),
        xpub: bounded(256).nullish(),
      }),
    )
    .max(64)
    .optional(),
  businessProfile: z
    .object({
      legalName: bounded(200).optional(),
      addressLine1: bounded(200).optional(),
      addressLine2: bounded(200).nullish(),
      city: bounded(120).optional(),
      postalCode: bounded(32).optional(),
      country: bounded(2).optional(),
      taxId: bounded(64).nullish(),
      supportEmail: bounded(254).optional(),
      logoUrl: logoUrlSchema.nullish(),
      invoicePrefix: bounded(16).optional(),
      invoiceFooter: bounded(2000).nullish(),
    })
    .optional(),
  notificationsEnabled: z.boolean().optional(),
  notificationPreferences: z.record(z.string(), z.boolean()).optional(),
});

export async function PATCH(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId } = ctx;

  const rawBody = await readJsonBody(request);
  if (!rawBody.ok) return rawBody.response;
  const parsed = parseWith(settingsSchema, rawBody.data);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // The payout wallet decides where every future payment is sent. Gating it
  // on "has a session with an active org" meant a `member`-role invitee
  // could redirect the merchant's funds.
  if (body.networks !== undefined) {
    const role = await requireRole(ctx);
    if (!role.ok) return role.response;
  }

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

  if (body.name !== undefined && body.name.length > 0) {
    updates.name = body.name;
  }

  if (body.walletAddress !== undefined) {
    const addr = body.walletAddress;
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

  if (body.checkoutFieldDefaults) {
    const f = body.checkoutFieldDefaults;
    updates.checkoutFieldDefaults = {
      firstName: Boolean(f.firstName),
      lastName: Boolean(f.lastName),
      email: Boolean(f.email),
      phone: Boolean(f.phone),
    };
  }

  if (body.networks) {
    for (const entry of body.networks) {
      // Keep a widened copy: assertValidNetworkKey is an assertion function
      // that narrows its argument to the EVM union, which would make the
      // Solana/UTXO family checks below unreachable at the type level.
      const networkKey = String(entry.networkKey);
      const isSolana =
        networkKey === "solana" || networkKey === "solana-devnet";
      const isUtxo = isUtxoNetwork(networkKey);

      // The settings UI disables the Bitcoin/Litecoin rows, but a merchant
      // can PATCH here directly. Enabling a UTXO payout today produces a
      // receive address the buyer can pay into while the indexer refuses to
      // record the payment (no captured fiat rate) — so refuse to turn it on
      // at all. Disabling one stays allowed, so anyone who already enabled a
      // network can back it out.
      //
      // This MUST run before assertValidNetworkKey: that helper only accepts
      // the EVM union, so it would otherwise reject "bitcoin" with a generic
      // `invalid_network_key` and the merchant would never see why.
      if (!UTXO_PAYMENTS_ENABLED && isUtxo && entry.enabled) {
        return NextResponse.json(
          {
            error: {
              code: "network_unavailable",
              message: UTXO_MERCHANT_NOTICE,
            },
          },
          { status: 409 },
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
      const addr = isUtxo ? null : entry.overrideAddress;
      const xpub = isUtxo ? (entry.xpub ?? null) : null;

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

  if (body.businessProfile) {
    const bp = body.businessProfile;
    // Values are already trimmed + length-capped by the schema; no ad-hoc
    // String() coercion, so an object or array can't reach the column.
    const profileValues = {
      legalName: bp.legalName ?? "",
      addressLine1: bp.addressLine1 ?? "",
      addressLine2: bp.addressLine2 ?? null,
      city: bp.city ?? "",
      postalCode: bp.postalCode ?? "",
      country: (bp.country ?? "").toUpperCase(),
      taxId: bp.taxId ?? null,
      supportEmail: bp.supportEmail ?? "",
      logoUrl: bp.logoUrl ?? null,
      invoicePrefix: bp.invoicePrefix || "INV-",
      invoiceFooter: bp.invoiceFooter ?? null,
    };
    await db
      .insert(merchantProfiles)
      .values({ organizationId, ...profileValues })
      .onConflictDoUpdate({
        target: merchantProfiles.organizationId,
        set: { ...profileValues, updatedAt: new Date() },
      });
  }

  if (body.notificationsEnabled !== undefined) {
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

  if (body.notificationPreferences) {
    const incoming = body.notificationPreferences;

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
      const value = incoming[kind];
      if (typeof value === "boolean") {
        merged[kind] = value;
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
      body.networks !== undefined ||
      body.businessProfile !== undefined ||
      body.notificationsEnabled !== undefined ||
      body.notificationPreferences !== undefined
    ) {
      void recordAudit({
        organizationId,
        userId,
        action: "settings.updated",
        resourceType: "settings",
        details: {
          networks: body.networks !== undefined,
          businessProfile: body.businessProfile !== undefined,
          notificationsEnabled: body.notificationsEnabled,
          notificationPreferences: body.notificationPreferences ?? undefined,
        },
        ipAddress: clientIp(request),
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
    ipAddress: clientIp(request),
  });

  return NextResponse.json(updated);
}
