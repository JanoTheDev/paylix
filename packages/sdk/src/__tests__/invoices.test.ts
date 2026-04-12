import { describe, it, expect, vi, beforeEach } from "vitest";
import { Paylix } from "../client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const paylix = new Paylix({
  apiKey: "sk_test_123",
  network: "base-sepolia",
  backendUrl: "http://localhost:3000",
});

beforeEach(() => mockFetch.mockReset());

describe("createPortalSession", () => {
  it("GETs /api/customers/:customerId/portal-url", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: "http://localhost:3000/portal/signed-abc" }),
    });
    const result = await paylix.createPortalSession({ customerId: "cust-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/customers/cust-1/portal-url",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.url).toBe("http://localhost:3000/portal/signed-abc");
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
      json: async () => ({ error: "Customer not found" }),
    });
    await expect(paylix.createPortalSession({ customerId: "bad" })).rejects.toThrow(
      "Paylix createPortalSession failed: Customer not found",
    );
  });
});

describe("listCustomerInvoices", () => {
  it("GETs /api/customers/:customerId/invoices", async () => {
    const invoiceData = {
      invoices: [{
        id: "inv-1",
        number: "INV-001",
        totalCents: 1000,
        subtotalCents: 950,
        taxCents: 50,
        taxLabel: "VAT",
        currency: "USDC",
        issuedAt: "2026-04-01T00:00:00Z",
        emailStatus: "sent",
        hostedUrl: "http://localhost:3000/invoices/inv-1",
        invoicePdfUrl: "http://localhost:3000/invoices/inv-1/pdf",
        receiptPdfUrl: "http://localhost:3000/invoices/inv-1/receipt",
      }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => invoiceData,
    });
    const result = await paylix.listCustomerInvoices({ customerId: "cust-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/customers/cust-1/invoices",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].number).toBe("INV-001");
    expect(result.invoices[0].totalCents).toBe(1000);
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Forbidden",
      json: async () => ({ error: "Access denied" }),
    });
    await expect(paylix.listCustomerInvoices({ customerId: "bad" })).rejects.toThrow(
      "Paylix listCustomerInvoices failed: Access denied",
    );
  });
});
