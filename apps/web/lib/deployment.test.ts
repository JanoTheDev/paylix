import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveDeploymentForMode } from "./deployment";

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe("resolveDeploymentForMode", () => {
  it("returns base-sepolia deployment for test mode", () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://sepolia.base.example";
    process.env.BASE_SEPOLIA_PAYMENT_VAULT = "0x1111111111111111111111111111111111111111";
    process.env.BASE_SEPOLIA_SUBSCRIPTION_MANAGER = "0x2222222222222222222222222222222222222222";
    process.env.BASE_SEPOLIA_MOCK_USDC_ADDRESS = "0x3333333333333333333333333333333333333333";

    const result = resolveDeploymentForMode(false);

    expect(result.network.key).toBe("base-sepolia");
    expect(result.chainId).toBe(84532);
    expect(result.rpcUrl).toBe("https://sepolia.base.example");
    expect(result.paymentVault).toBe("0x1111111111111111111111111111111111111111");
    expect(result.subscriptionManager).toBe("0x2222222222222222222222222222222222222222");
    expect(result.usdcAddress).toBe("0x3333333333333333333333333333333333333333");
  });

  it("returns base mainnet deployment for live mode", () => {
    process.env.BASE_RPC_URL = "https://base.example";
    process.env.BASE_PAYMENT_VAULT = "0x4444444444444444444444444444444444444444";
    process.env.BASE_SUBSCRIPTION_MANAGER = "0x5555555555555555555555555555555555555555";

    const result = resolveDeploymentForMode(true);

    expect(result.network.key).toBe("base");
    expect(result.chainId).toBe(8453);
    expect(result.rpcUrl).toBe("https://base.example");
    expect(result.paymentVault).toBe("0x4444444444444444444444444444444444444444");
    expect(result.subscriptionManager).toBe("0x5555555555555555555555555555555555555555");
    // Canonical Circle USDC on base mainnet
    expect(result.usdcAddress.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("throws when test-mode env vars are missing", () => {
    delete process.env.BASE_SEPOLIA_RPC_URL;
    delete process.env.BASE_SEPOLIA_PAYMENT_VAULT;
    delete process.env.BASE_SEPOLIA_SUBSCRIPTION_MANAGER;
    delete process.env.BASE_SEPOLIA_MOCK_USDC_ADDRESS;

    expect(() => resolveDeploymentForMode(false)).toThrow(/BASE_SEPOLIA_/);
  });

  it("throws when live-mode env vars are missing", () => {
    delete process.env.BASE_RPC_URL;
    delete process.env.BASE_PAYMENT_VAULT;
    delete process.env.BASE_SUBSCRIPTION_MANAGER;

    expect(() => resolveDeploymentForMode(true)).toThrow(/BASE_/);
  });
});
