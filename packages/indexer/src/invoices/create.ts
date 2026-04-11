import { generateHostedToken } from "./token";

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export interface ProfileInput {
  userId: string;
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  postalCode: string;
  country: string;
  taxId: string | null;
  supportEmail: string;
  logoUrl: string | null;
  invoicePrefix: string;
  invoiceFooter: string | null;
  invoiceSequence: number;
}

export interface ProductInput {
  id: string;
  name: string;
  taxRateBps: number | null;
  taxLabel: string | null;
  reverseChargeEligible: boolean;
}

export interface CustomerInput {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  country: string | null;
  taxId: string | null;
}

export interface PaymentInput {
  id: string;
  amount: number; // cents
}

export interface BuildInvoiceArgs {
  profile: ProfileInput;
  product: ProductInput;
  customer: CustomerInput;
  payment: PaymentInput;
}

export interface BuiltInvoice {
  invoice: {
    merchantId: string;
    paymentId: string;
    customerId: string;
    hostedToken: string;
    number: string;

    merchantLegalName: string;
    merchantAddressLine1: string;
    merchantAddressLine2: string | null;
    merchantCity: string;
    merchantPostalCode: string;
    merchantCountry: string;
    merchantTaxId: string | null;
    merchantSupportEmail: string;
    merchantLogoUrl: string | null;
    merchantFooter: string | null;

    customerName: string | null;
    customerEmail: string | null;
    customerCountry: string | null;
    customerTaxId: string | null;
    customerAddress: string | null;

    currency: "USDC";
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    taxLabel: string | null;
    taxRateBps: number | null;
    reverseCharge: boolean;
  };
  lineItems: {
    description: string;
    quantity: number;
    unitAmountCents: number;
    amountCents: number;
  }[];
  nextSequence: number;
}

function formatNumber(prefix: string, sequence: number): string {
  const padded = String(sequence).padStart(6, "0");
  return `${prefix}${padded}`;
}

function computeCustomerName(c: CustomerInput): string | null {
  const parts = [c.firstName, c.lastName].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function buildInvoice(args: BuildInvoiceArgs): BuiltInvoice {
  const { profile, product, customer, payment } = args;

  const subtotalCents = payment.amount;
  const nextSequence = profile.invoiceSequence + 1;

  const reverseChargeEligible =
    product.reverseChargeEligible &&
    !!customer.taxId &&
    !!customer.country &&
    EU_COUNTRIES.has(customer.country.toUpperCase());

  let taxCents = 0;
  let taxLabel: string | null = null;
  let taxRateBps: number | null = null;
  let reverseCharge = false;

  if (reverseChargeEligible) {
    taxCents = 0;
    taxLabel = "Reverse charge — recipient liable";
    taxRateBps = product.taxRateBps;
    reverseCharge = true;
  } else if (product.taxRateBps && product.taxRateBps > 0) {
    taxCents = Math.round((subtotalCents * product.taxRateBps) / 10_000);
    taxLabel = product.taxLabel;
    taxRateBps = product.taxRateBps;
  }

  const totalCents = subtotalCents + taxCents;

  return {
    invoice: {
      merchantId: profile.userId,
      paymentId: payment.id,
      customerId: customer.id,
      hostedToken: generateHostedToken(),
      number: formatNumber(profile.invoicePrefix, nextSequence),

      merchantLegalName: profile.legalName,
      merchantAddressLine1: profile.addressLine1,
      merchantAddressLine2: profile.addressLine2,
      merchantCity: profile.city,
      merchantPostalCode: profile.postalCode,
      merchantCountry: profile.country,
      merchantTaxId: profile.taxId,
      merchantSupportEmail: profile.supportEmail,
      merchantLogoUrl: profile.logoUrl,
      merchantFooter: profile.invoiceFooter,

      customerName: computeCustomerName(customer),
      customerEmail: customer.email,
      customerCountry: customer.country,
      customerTaxId: customer.taxId,
      customerAddress: null,

      currency: "USDC",
      subtotalCents,
      taxCents,
      totalCents,
      taxLabel,
      taxRateBps,
      reverseCharge,
    },
    lineItems: [
      {
        description: product.name,
        quantity: 1,
        unitAmountCents: subtotalCents,
        amountCents: subtotalCents,
      },
    ],
    nextSequence,
  };
}
