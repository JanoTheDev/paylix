import { describe, it, expect } from "vitest";
import { buildInvoice } from "../invoices/create";

const profile = {
  userId: "user_1",
  legalName: "Acme Ltd",
  addressLine1: "1 Main St",
  addressLine2: null,
  city: "London",
  postalCode: "SW1A 1AA",
  country: "GB",
  taxId: "GB123456789",
  supportEmail: "support@acme.test",
  logoUrl: null,
  invoicePrefix: "ACME-",
  invoiceFooter: "Thanks",
  invoiceSequence: 41,
};

const product = {
  id: "prod_1",
  name: "Pro Plan",
  taxRateBps: 2000,
  taxLabel: "VAT 20%",
  reverseChargeEligible: true,
};

const customer = {
  id: "cust_1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@buyer.test",
  country: null,
  taxId: null,
};

const payment = {
  id: "pay_1",
  amount: 10000, // cents — $100
};

describe("buildInvoice", () => {
  it("applies tax when customer has no tax ID", () => {
    const result = buildInvoice({ profile, product, customer, payment });
    expect(result.invoice.subtotalCents).toBe(10000);
    expect(result.invoice.taxCents).toBe(2000);
    expect(result.invoice.totalCents).toBe(12000);
    expect(result.invoice.taxLabel).toBe("VAT 20%");
    expect(result.invoice.taxRateBps).toBe(2000);
    expect(result.invoice.reverseCharge).toBe(false);
  });

  it("applies reverse charge when eligible + customer has EU tax ID", () => {
    const result = buildInvoice({
      profile,
      product,
      customer: { ...customer, country: "DE", taxId: "DE999999999" },
      payment,
    });
    expect(result.invoice.subtotalCents).toBe(10000);
    expect(result.invoice.taxCents).toBe(0);
    expect(result.invoice.totalCents).toBe(10000);
    expect(result.invoice.taxLabel).toBe("Reverse charge — recipient liable");
    expect(result.invoice.reverseCharge).toBe(true);
  });

  it("does not reverse-charge when product not eligible", () => {
    const result = buildInvoice({
      profile,
      product: { ...product, reverseChargeEligible: false },
      customer: { ...customer, country: "DE", taxId: "DE999999999" },
      payment,
    });
    expect(result.invoice.taxCents).toBe(2000);
    expect(result.invoice.reverseCharge).toBe(false);
  });

  it("emits no tax when product has no rate", () => {
    const result = buildInvoice({
      profile,
      product: { ...product, taxRateBps: null, taxLabel: null },
      customer,
      payment,
    });
    expect(result.invoice.taxCents).toBe(0);
    expect(result.invoice.totalCents).toBe(10000);
    expect(result.invoice.taxLabel).toBeNull();
    expect(result.invoice.taxRateBps).toBeNull();
  });

  it("formats invoice number using prefix and next sequence", () => {
    const result = buildInvoice({ profile, product, customer, payment });
    expect(result.invoice.number).toBe("ACME-000042");
    expect(result.nextSequence).toBe(42);
  });

  it("generates a 32+ char unguessable hosted token", () => {
    const result = buildInvoice({ profile, product, customer, payment });
    expect(result.invoice.hostedToken.length).toBeGreaterThanOrEqual(30);
    expect(/^[A-Za-z0-9_-]+$/.test(result.invoice.hostedToken)).toBe(true);
  });

  it("creates one line item matching the payment amount", () => {
    const result = buildInvoice({ profile, product, customer, payment });
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].description).toBe("Pro Plan");
    expect(result.lineItems[0].quantity).toBe(1);
    expect(result.lineItems[0].unitAmountCents).toBe(10000);
    expect(result.lineItems[0].amountCents).toBe(10000);
  });

  it("snapshots customer name from first + last", () => {
    const result = buildInvoice({ profile, product, customer, payment });
    expect(result.invoice.customerName).toBe("Jane Doe");
    expect(result.invoice.customerEmail).toBe("jane@buyer.test");
  });

  it("snapshots all merchant fields", () => {
    const result = buildInvoice({ profile, product, customer, payment });
    expect(result.invoice.merchantLegalName).toBe("Acme Ltd");
    expect(result.invoice.merchantAddressLine1).toBe("1 Main St");
    expect(result.invoice.merchantCity).toBe("London");
    expect(result.invoice.merchantPostalCode).toBe("SW1A 1AA");
    expect(result.invoice.merchantCountry).toBe("GB");
    expect(result.invoice.merchantTaxId).toBe("GB123456789");
    expect(result.invoice.merchantSupportEmail).toBe("support@acme.test");
    expect(result.invoice.merchantFooter).toBe("Thanks");
  });
});
