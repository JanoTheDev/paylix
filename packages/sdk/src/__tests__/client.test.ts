import { describe, it, expect } from "vitest";
import { Paylix } from "../client";

describe("Paylix", () => {
  const validConfig = {
    apiKey: "pk_test_abc123",
    network: "base-sepolia" as const,
    backendUrl: "http://localhost:3000",
  };

  it("creates instance with valid config", () => {
    const paylix = new Paylix(validConfig);
    expect(paylix).toBeInstanceOf(Paylix);
  });

  it("throws if apiKey is missing", () => {
    expect(() => new Paylix({ ...validConfig, apiKey: "" })).toThrow("apiKey is required");
  });

  it("throws if backendUrl is missing", () => {
    expect(() => new Paylix({ ...validConfig, backendUrl: "" })).toThrow("backendUrl is required");
  });

  it("throws if network is unsupported", () => {
    // "solana-fake" isn't in the SDK's NETWORKS table; polygon is now a
    // real entry so using it wouldn't trigger the error path any more.
    expect(() => new Paylix({ ...validConfig, network: "solana-fake" as any })).toThrow("unsupported network");
  });

  it("exposes network config", () => {
    const paylix = new Paylix(validConfig);
    expect(paylix.network?.chainId).toBe(84532);
    expect(paylix.network?.isEvm).toBe(true);
    expect(paylix.network?.explorerUrl).toBe("https://sepolia.basescan.org");
  });

  it("allows omitting network entirely", () => {
    const paylix = new Paylix({
      apiKey: "sk_test_1",
      backendUrl: "http://localhost:3000",
    });
    expect(paylix.network).toBeUndefined();
  });
});
