import { describe, it, expect, vi, beforeEach } from "vitest";
import { Paylix } from "../client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const paylix = new Paylix({
  apiKey: "sk_test_abc",
  network: "base-sepolia",
  backendUrl: "http://localhost:3000",
});

beforeEach(() => mockFetch.mockReset());

describe("paylix.test.faucet", () => {
  it("POSTs to /api/test/faucet with the API key and returns the response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        txHash: "0xdeadbeef",
        amountMinted: 1000,
      }),
    });

    const result = await paylix.testFaucet({
      address: "0x1111111111111111111111111111111111111111",
    });

    expect(result.txHash).toBe("0xdeadbeef");
    expect(result.amountMinted).toBe(1000);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe("http://localhost:3000/api/test/faucet");
    expect(calledInit.method).toBe("POST");
    expect(calledInit.headers["Authorization"]).toBe("Bearer sk_test_abc");
  });

  it("passes an optional amount", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        txHash: "0xabc",
        amountMinted: 500,
      }),
    });

    await paylix.testFaucet({
      address: "0x1111111111111111111111111111111111111111",
      amount: 500,
    });

    const [, calledInit] = mockFetch.mock.calls[0];
    const body = JSON.parse(calledInit.body as string);
    expect(body).toEqual({
      address: "0x1111111111111111111111111111111111111111",
      amount: 500,
    });
  });

  it("throws on error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({
        error: "The faucet is only available in test mode.",
      }),
    });

    await expect(
      paylix.testFaucet({
        address: "0x1111111111111111111111111111111111111111",
      }),
    ).rejects.toThrow(/test mode/);
  });
});
