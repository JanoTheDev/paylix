import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth";
import { products } from "./products";
import { payments } from "./payments";
import { subscriptions } from "./subscriptions";
import { coupons } from "./coupons";

export const checkoutStatusEnum = pgEnum("checkout_status", [
  "awaiting_currency", // session created, buyer hasn't selected network/token yet
  "active",            // link created, not yet opened
  "viewed",            // user opened the checkout page
  "abandoned",         // user saw it but left without paying
  "completed",         // payment confirmed
  "expired",           // session expired (30 min default)
]);

export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  customerId: text("customer_id"),
  merchantWallet: text("merchant_wallet").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  subtotalAmount: bigint("subtotal_amount", { mode: "bigint" }),
  taxAmount: bigint("tax_amount", { mode: "bigint" }),
  taxRateBps: integer("tax_rate_bps"),
  taxLabel: text("tax_label"),
  networkKey: text("network_key"),   // nullable while awaiting_currency
  tokenSymbol: text("token_symbol"), // nullable while awaiting_currency
  type: text("type").notNull().default("one_time"),
  quantity: integer("quantity").notNull().default(1),
  collectCountry: boolean("collect_country").notNull().default(false),
  collectTaxId: boolean("collect_tax_id").notNull().default(false),
  buyerCountry: text("buyer_country"),
  buyerTaxId: text("buyer_tax_id"),
  buyerFirstName: text("buyer_first_name"),
  buyerLastName: text("buyer_last_name"),
  buyerEmail: text("buyer_email"),
  buyerPhone: text("buyer_phone"),
  status: checkoutStatusEnum("status").notNull().default("active"),
  successUrl: text("success_url"),
  cancelUrl: text("cancel_url"),
  metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
  appliedCouponId: uuid("applied_coupon_id").references(() => coupons.id, {
    onDelete: "set null",
  }),
  discountCents: integer("discount_cents"),
  paymentId: uuid("payment_id").references(() => payments.id, {
    onDelete: "set null",
  }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
    onDelete: "set null",
  }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  relayInFlightAt: timestamp("relay_in_flight_at", { withTimezone: true }),
  recoveryEmailSentAt: timestamp("recovery_email_sent_at", { withTimezone: true }),
  livemode: boolean("livemode").notNull().default(false),
  // UTXO-chain (Bitcoin / Litecoin) session fields. NULL for EVM sessions.
  // `btcReceiveAddress` is the BIP32-derived per-session address the buyer
  // sends to; `btcSessionIndex` is the index under the merchant's xpub so
  // future sessions never re-derive the same address.
  btcReceiveAddress: text("btc_receive_address"),
  btcSessionIndex: bigint("btc_session_index", { mode: "number" }),
  // Fiat rate locked at quote time so the payment row can record real cents
  // for a volatile native coin (IDX-04). Must be captured here, when the buyer
  // is quoted — not when the transaction confirms.
  fiatRateCents: integer("fiat_rate_cents"), // cents per 1 whole coin
  fiatRateCapturedAt: timestamp("fiat_rate_captured_at", { withTimezone: true }),
  // Highest platform fee (basis points) the buyer will agree to when they sign
  // this session's PaymentIntent / SubscriptionIntent. Locked at QUOTE time.
  //
  // SC-03: `setPlatformFee` used to be readable at settlement and was not bound
  // into the intent typehash, so the platform owner could raise the fee
  // retroactively against already-signed intents. The contracts now bind
  // `maxFeeBps` into the typehash and enforce
  // `require(platformFee <= maxFeeBps)` (PaymentVault.sol:148,
  // SubscriptionManager.sol:267). This column is the server-side origin of that
  // number.
  //
  // It is STORED rather than read live at signing time on purpose: a live read
  // races an owner fee raise between quote and signature, which is exactly the
  // attack SC-03 closes. Only a value locked when the buyer was quoted actually
  // holds.
  //
  // Units are basis points against PaymentVault.MAX_PLATFORM_FEE_BPS = 1000
  // (10%), so 50 means 0.5%. The CHECK enforces that range at the DB level —
  // a bug writing 10000 here would be the buyer signing away a 100% fee
  // ceiling, so it is worth refusing at the last line of defence.
  //
  // NULLABLE deliberately — see the note on the table's check constraint below.
  maxFeeBps: integer("max_fee_bps"),
  // keccak256(stringToBytes(session.id)), written at session creation. The
  // indexer currently brute-force hashes the 200 most recent open sessions to
  // match an on-chain customerId (IDX-27); above 200 concurrent open sessions
  // for one merchant a valid payment is diverted to the unmatched queue.
  customerIdHash: text("customer_id_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Dashboard / API listing: `where organization_id = ? and livemode = ?
  // order by created_at desc` (apps/web/app/api/checkout-links/route.ts).
  index("checkout_sessions_org_created_idx").on(
    table.organizationId,
    table.createdAt,
  ),
  // Expiry + abandonment sweeps and the UTXO watcher's boot scan, which
  // filter on status and then a timestamp
  // (packages/indexer/src/abandonment.ts, packages/utxo-indexer).
  index("checkout_sessions_status_expires_idx").on(
    table.status,
    table.expiresAt,
  ),
  // Runs on EVERY PaymentReceived / SubscriptionCreated: the indexer matches an
  // on-chain event to an open session by `lower(merchant_wallet)`
  // (packages/indexer/src/handlers.ts:233, :796). The column is never filtered
  // raw, so only an expression index can serve it.
  //
  // Pure expression — NOT `(lower(merchant_wallet), status)` — because
  // drizzle-kit 0.30.6 crashes introspecting a MIXED plain-column + expression
  // index; see the note in customers.ts. The status filter is applied on top,
  // and checkout_sessions_status_expires_idx covers status separately.
  index("checkout_sessions_merchant_wallet_lower_idx").on(
    sql`lower(${table.merchantWallet})`,
  ),
  // Join key: payments detail page left-joins sessions on payment_id.
  index("checkout_sessions_payment_idx").on(table.paymentId),
  index("checkout_sessions_subscription_idx").on(table.subscriptionId),
  index("checkout_sessions_product_idx").on(table.productId),
  // Direct session lookup for the indexer's on-chain customerId match (IDX-27),
  // replacing the bounded 200-row scan.
  index("checkout_sessions_customer_id_hash_idx").on(table.customerIdHash),
  // Re-declared from 0030_add_utxo_support.sql. Without it in the schema,
  // `db:push` drops the only guard against two sessions sharing a Bitcoin
  // receive address.
  uniqueIndex("btc_session_address_idx")
    .on(table.btcReceiveAddress)
    .where(sql`btc_receive_address is not null`),
  // `max_fee_bps` is NULLABLE, not `NOT NULL DEFAULT <something>`, because the
  // column records what a buyer AGREED TO. Back-filling a default would assert
  // a consent that was never given, and for sessions quoted before this column
  // existed the true value is simply unknowable — which is the exact class of
  // problem SC-03 exists to prevent. NULL honestly means "no ceiling was
  // recorded for this session".
  //
  // That is safe because the client fails closed: it refuses to request a
  // signature at all when the ceiling is absent, so a NULL degrades to "gasless
  // checkout unavailable for this stale session" rather than to an unsafe
  // default. The CHECK is written to allow NULL but constrain every non-NULL
  // value to the contract's own bound.
  check(
    "checkout_sessions_max_fee_bps_range",
    sql`${table.maxFeeBps} IS NULL OR (${table.maxFeeBps} >= 0 AND ${table.maxFeeBps} <= 1000)`,
  ),
]);

export type CheckoutSession = typeof checkoutSessions.$inferSelect;
export type NewCheckoutSession = typeof checkoutSessions.$inferInsert;
