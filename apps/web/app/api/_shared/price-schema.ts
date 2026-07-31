/**
 * Shared validation for `product_prices` payloads.
 *
 * `amount` is a native-token-unit integer sent as a string so 18-decimal
 * values survive JSON. Before this, both product routes typed it as a bare
 * `z.string()` and handed it straight to `BigInt()` inside `db.transaction`:
 * `"abc"` threw an uncaught SyntaxError (500 instead of 400) and `"-5000"`
 * was accepted, creating a negative price that `pick-currency` later
 * multiplied by the buyer's quantity.
 */

import { z } from "zod";

/** ~10^40 native units is far beyond any real token supply. */
export const PRICE_AMOUNT_MAX_DIGITS = 40;

export const priceAmountSchema = z
  .string()
  .regex(/^\d+$/, "price amount must be a non-negative integer string")
  .max(PRICE_AMOUNT_MAX_DIGITS, "price amount is out of range")
  .refine((v) => BigInt(v) > 0n, "price amount must be greater than zero");

export const productPriceSchema = z.object({
  networkKey: z.string().min(1).max(64),
  tokenSymbol: z.string().min(1).max(32),
  amount: priceAmountSchema,
});
