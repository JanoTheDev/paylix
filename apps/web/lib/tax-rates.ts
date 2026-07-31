/**
 * Built-in VAT + sales tax rates. Merchant-curated — the operator can
 * override per product via `products.taxRateBps` + `products.taxLabel`,
 * but this table powers the default when `autoTaxEnabled` is on.
 *
 * Rates are integer basis points (1900 = 19.00%).
 */

export interface TaxResolution {
  rateBps: number;
  label: string;
  taxCents: number;
  subtotalCents: number;
  totalCents: number;
}

// EU VAT OSS standard rates (2026). Keep in a single map; update as
// member states change their headline VAT rate. Country codes are
// ISO 3166-1 alpha-2 uppercase.
const EU_VAT_BPS: Record<string, { rateBps: number; label: string }> = {
  AT: { rateBps: 2000, label: "AT VAT 20%" },
  BE: { rateBps: 2100, label: "BE VAT 21%" },
  BG: { rateBps: 2000, label: "BG VAT 20%" },
  HR: { rateBps: 2500, label: "HR VAT 25%" },
  CY: { rateBps: 1900, label: "CY VAT 19%" },
  CZ: { rateBps: 2100, label: "CZ VAT 21%" },
  DK: { rateBps: 2500, label: "DK VAT 25%" },
  EE: { rateBps: 2200, label: "EE VAT 22%" },
  FI: { rateBps: 2550, label: "FI VAT 25.5%" },
  FR: { rateBps: 2000, label: "FR VAT 20%" },
  DE: { rateBps: 1900, label: "DE VAT 19%" },
  GR: { rateBps: 2400, label: "GR VAT 24%" },
  HU: { rateBps: 2700, label: "HU VAT 27%" },
  IE: { rateBps: 2300, label: "IE VAT 23%" },
  IT: { rateBps: 2200, label: "IT VAT 22%" },
  LV: { rateBps: 2100, label: "LV VAT 21%" },
  LT: { rateBps: 2100, label: "LT VAT 21%" },
  LU: { rateBps: 1700, label: "LU VAT 17%" },
  MT: { rateBps: 1800, label: "MT VAT 18%" },
  NL: { rateBps: 2100, label: "NL VAT 21%" },
  PL: { rateBps: 2300, label: "PL VAT 23%" },
  PT: { rateBps: 2300, label: "PT VAT 23%" },
  RO: { rateBps: 1900, label: "RO VAT 19%" },
  SK: { rateBps: 2300, label: "SK VAT 23%" },
  SI: { rateBps: 2200, label: "SI VAT 22%" },
  ES: { rateBps: 2100, label: "ES VAT 21%" },
  SE: { rateBps: 2500, label: "SE VAT 25%" },
  // Other European non-EU that operators often charge
  GB: { rateBps: 2000, label: "GB VAT 20%" },
  NO: { rateBps: 2500, label: "NO VAT 25%" },
  CH: { rateBps: 810, label: "CH VAT 8.1%" },
};

// US state headline sales tax (no locality). Operators that need
// precise locality rates should override per product; this is a
// reasonable default for merchants just starting out.
const US_STATE_BPS: Record<string, { rateBps: number; label: string }> = {
  AL: { rateBps: 400, label: "AL sales tax 4%" },
  AK: { rateBps: 0, label: "AK no state sales tax" },
  AZ: { rateBps: 560, label: "AZ TPT 5.6%" },
  AR: { rateBps: 650, label: "AR sales tax 6.5%" },
  CA: { rateBps: 725, label: "CA sales tax 7.25%" },
  CO: { rateBps: 290, label: "CO sales tax 2.9%" },
  CT: { rateBps: 635, label: "CT sales tax 6.35%" },
  DE: { rateBps: 0, label: "DE no state sales tax" },
  FL: { rateBps: 600, label: "FL sales tax 6%" },
  GA: { rateBps: 400, label: "GA sales tax 4%" },
  HI: { rateBps: 400, label: "HI GET 4%" },
  ID: { rateBps: 600, label: "ID sales tax 6%" },
  IL: { rateBps: 625, label: "IL sales tax 6.25%" },
  IN: { rateBps: 700, label: "IN sales tax 7%" },
  IA: { rateBps: 600, label: "IA sales tax 6%" },
  KS: { rateBps: 650, label: "KS sales tax 6.5%" },
  KY: { rateBps: 600, label: "KY sales tax 6%" },
  LA: { rateBps: 500, label: "LA sales tax 5%" },
  ME: { rateBps: 550, label: "ME sales tax 5.5%" },
  MD: { rateBps: 600, label: "MD sales tax 6%" },
  MA: { rateBps: 625, label: "MA sales tax 6.25%" },
  MI: { rateBps: 600, label: "MI sales tax 6%" },
  MN: { rateBps: 688, label: "MN sales tax 6.875%" },
  MS: { rateBps: 700, label: "MS sales tax 7%" },
  MO: { rateBps: 423, label: "MO sales tax 4.225%" },
  MT: { rateBps: 0, label: "MT no state sales tax" },
  NE: { rateBps: 550, label: "NE sales tax 5.5%" },
  NV: { rateBps: 685, label: "NV sales tax 6.85%" },
  NH: { rateBps: 0, label: "NH no state sales tax" },
  NJ: { rateBps: 663, label: "NJ sales tax 6.625%" },
  NM: { rateBps: 488, label: "NM GRT 4.875%" },
  NY: { rateBps: 400, label: "NY sales tax 4%" },
  NC: { rateBps: 475, label: "NC sales tax 4.75%" },
  ND: { rateBps: 500, label: "ND sales tax 5%" },
  OH: { rateBps: 575, label: "OH sales tax 5.75%" },
  OK: { rateBps: 450, label: "OK sales tax 4.5%" },
  OR: { rateBps: 0, label: "OR no state sales tax" },
  PA: { rateBps: 600, label: "PA sales tax 6%" },
  RI: { rateBps: 700, label: "RI sales tax 7%" },
  SC: { rateBps: 600, label: "SC sales tax 6%" },
  SD: { rateBps: 420, label: "SD sales tax 4.2%" },
  TN: { rateBps: 700, label: "TN sales tax 7%" },
  TX: { rateBps: 625, label: "TX sales tax 6.25%" },
  UT: { rateBps: 485, label: "UT sales tax 4.85%" },
  VT: { rateBps: 600, label: "VT sales tax 6%" },
  VA: { rateBps: 530, label: "VA sales tax 5.3%" },
  WA: { rateBps: 650, label: "WA sales tax 6.5%" },
  WV: { rateBps: 600, label: "WV sales tax 6%" },
  WI: { rateBps: 500, label: "WI sales tax 5%" },
  WY: { rateBps: 400, label: "WY sales tax 4%" },
  DC: { rateBps: 600, label: "DC sales tax 6%" },
};

export interface ResolveTaxInput {
  country: string | null | undefined;
  state?: string | null;
  /** Subtotal in integer cents (after any discounts). */
  subtotalCents: number;
  /** Merchant-supplied override; if present, wins over the rate table. */
  productRateBps?: number | null;
  productLabel?: string | null;
  /** If the buyer has a valid tax id and the product is reverse-charge
   *  eligible, skip tax entirely. */
  reverseCharge?: boolean;
}

/**
 * `floor(subtotal * rateBps / 10000)` computed in bigint. Done in Number,
 * the intermediate product overflows Number.MAX_SAFE_INTEGER for large
 * invoices and starts losing cents.
 */
function taxOf(subtotalCents: number, rateBps: number): number {
  return Number((BigInt(subtotalCents) * BigInt(rateBps)) / 10000n);
}

/**
 * Resolve a tax amount from the rate table. Returns null when no rate
 * applies (non-EU, non-US, or country unknown). All cents are integers;
 * tax is `floor(subtotal * rateBps / 10000)` — merchant-friendly
 * rounding so we never over-collect by a cent on edge cases.
 */
export function resolveTax(input: ResolveTaxInput): TaxResolution | null {
  // NOT `| 0`: the bitwise OR coerces to int32, so any subtotal above
  // 2,147,483,647 cents wraps negative and then flattens to 0 — silently
  // returning "no tax" on large invoices.
  if (!Number.isFinite(input.subtotalCents)) return null;
  const subtotal = Math.max(0, Math.trunc(input.subtotalCents));
  if (subtotal === 0 || !Number.isSafeInteger(subtotal)) return null;
  if (input.reverseCharge) {
    return {
      rateBps: 0,
      label: "Reverse charge",
      taxCents: 0,
      subtotalCents: subtotal,
      totalCents: subtotal,
    };
  }

  // Product-level override wins.
  if (
    input.productRateBps !== null &&
    input.productRateBps !== undefined &&
    Number.isSafeInteger(input.productRateBps) &&
    input.productRateBps > 0
  ) {
    const rateBps = input.productRateBps;
    const tax = taxOf(subtotal, rateBps);
    return {
      rateBps,
      label: input.productLabel ?? `Tax ${(rateBps / 100).toFixed(2)}%`,
      taxCents: tax,
      subtotalCents: subtotal,
      totalCents: subtotal + tax,
    };
  }

  const country = input.country?.trim().toUpperCase();
  if (!country) return null;

  // EU + selected European
  const eu = EU_VAT_BPS[country];
  if (eu) {
    const tax = taxOf(subtotal, eu.rateBps);
    return {
      rateBps: eu.rateBps,
      label: eu.label,
      taxCents: tax,
      subtotalCents: subtotal,
      totalCents: subtotal + tax,
    };
  }

  // US — look up state
  if (country === "US") {
    const state = input.state?.trim().toUpperCase();
    if (!state) return null;
    const entry = US_STATE_BPS[state];
    if (!entry) return null;
    const tax = taxOf(subtotal, entry.rateBps);
    return {
      rateBps: entry.rateBps,
      label: entry.label,
      taxCents: tax,
      subtotalCents: subtotal,
      totalCents: subtotal + tax,
    };
  }

  return null;
}
