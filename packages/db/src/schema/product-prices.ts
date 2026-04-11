import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { products } from "./products";

/**
 * Multi-currency pricing for products. A product can have 1..N prices,
 * each for a different (networkKey, tokenSymbol) pair. Merchants manage
 * each entry independently via the product form.
 *
 * `amount` is in the token's native units (bigint, can't use int due to
 * 18-decimal tokens overflowing JS safe integer range). Use
 * apps/web/lib/amounts.ts for conversion to/from human-readable strings.
 */
export const productPrices = pgTable(
  "product_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    // Validated at the application layer against @paylix/config/networks.
    // Kept as text so adding a new network doesn't require a DB migration.
    networkKey: text("network_key").notNull(),
    tokenSymbol: text("token_symbol").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("product_prices_unique").on(
      t.productId,
      t.networkKey,
      t.tokenSymbol,
    ),
    index("product_prices_product_idx").on(t.productId),
  ],
);

export type ProductPrice = typeof productPrices.$inferSelect;
export type NewProductPrice = typeof productPrices.$inferInsert;
