import { describe, it, expect } from "vitest";
import { Paylix } from "../client";

describe("Paylix", () => {
  const validConfig = {
    apiKey: "pk_test_abc123",
    network: "base-sepolia" as const,
    merchantWallet: "0x1234567890abcdef1234567890abcdef12345678",
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

  it("throws if merchantWallet is missing", () => {
    expect(() => new Paylix({ ...validConfig, merchantWallet: "" })).toThrow("merchantWallet is required");
  });

  it("throws if network is unsupported", () => {
    expect(() => new Paylix({ ...validConfig, network: "polygon" as any })).toThrow("unsupported network");
  });

  it("exposes network config", () => {
    const paylix = new Paylix(validConfig);
    expect(paylix.network.chainId).toBe(84532);
  });
});
