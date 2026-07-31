import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalEnv = process.env;

/**
 * `lib/chain.ts` reads NEXT_PUBLIC_NETWORK at module load, so each case sets
 * the env and re-imports the module graph rather than mutating a cached one.
 */
async function loadDeployment(network: string) {
  process.env.NEXT_PUBLIC_NETWORK = network;
  vi.resetModules();
  return (await import("./deployment")).resolveDeploymentForMode;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
  vi.resetModules();
});

// Each case re-imports the network registry + viem chains from scratch, which
// is well over the 5s default on a cold module graph.
describe("resolveDeploymentForMode", { timeout: 30_000 }, () => {
  it("returns the base-sepolia deployment for test mode", async () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://sepolia.base.example";
    process.env.BASE_SEPOLIA_PAYMENT_VAULT = "0x1111111111111111111111111111111111111111";
    process.env.BASE_SEPOLIA_SUBSCRIPTION_MANAGER = "0x2222222222222222222222222222222222222222";
    process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS = "0x3333333333333333333333333333333333333333";

    const resolve = await loadDeployment("base-sepolia");
    const result = resolve(false);

    expect(result.network.key).toBe("base-sepolia");
    expect(result.chainId).toBe(84532);
    expect(result.rpcUrl).toBe("https://sepolia.base.example");
    expect(result.paymentVault).toBe("0x1111111111111111111111111111111111111111");
    expect(result.subscriptionManager).toBe("0x2222222222222222222222222222222222222222");
    expect(result.usdcAddress).toBe("0x3333333333333333333333333333333333333333");
  });

  it("still honours the legacy BASE_SEPOLIA_MOCK_USDC_ADDRESS name", async () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://sepolia.base.example";
    process.env.BASE_SEPOLIA_PAYMENT_VAULT = "0x1111111111111111111111111111111111111111";
    process.env.BASE_SEPOLIA_SUBSCRIPTION_MANAGER = "0x2222222222222222222222222222222222222222";
    delete process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS;
    process.env.BASE_SEPOLIA_MOCK_USDC_ADDRESS = "0x4444444444444444444444444444444444444444";

    const resolve = await loadDeployment("base-sepolia");
    expect(resolve(false).usdcAddress).toBe("0x4444444444444444444444444444444444444444");
  });

  it("returns the base mainnet deployment for live mode", async () => {
    process.env.BASE_RPC_URL = "https://base.example";
    process.env.BASE_PAYMENT_VAULT = "0x4444444444444444444444444444444444444444";
    process.env.BASE_SUBSCRIPTION_MANAGER = "0x5555555555555555555555555555555555555555";

    const resolve = await loadDeployment("base");
    const result = resolve(true);

    expect(result.network.key).toBe("base");
    expect(result.chainId).toBe(8453);
    expect(result.rpcUrl).toBe("https://base.example");
    expect(result.paymentVault).toBe("0x4444444444444444444444444444444444444444");
    expect(result.subscriptionManager).toBe("0x5555555555555555555555555555555555555555");
    // Canonical Circle USDC on base mainnet
    expect(result.usdcAddress.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("resolves a non-Base network without touching BASE_* vars", async () => {
    process.env.POLYGON_RPC_URL = "https://polygon.example";
    process.env.POLYGON_PAYMENT_VAULT = "0x6666666666666666666666666666666666666666";
    process.env.POLYGON_SUBSCRIPTION_MANAGER = "0x7777777777777777777777777777777777777777";

    const resolve = await loadDeployment("polygon");
    const result = resolve(true);

    expect(result.network.key).toBe("polygon");
    expect(result.rpcUrl).toBe("https://polygon.example");
    expect(result.paymentVault).toBe("0x6666666666666666666666666666666666666666");
  });

  it("throws when the requested mode does not match the deployed network", async () => {
    const resolve = await loadDeployment("base-sepolia");
    expect(() => resolve(true)).toThrow(/NEXT_PUBLIC_NETWORK/);
  });

  it("throws when test-mode env vars are missing", async () => {
    delete process.env.BASE_SEPOLIA_RPC_URL;
    delete process.env.BASE_SEPOLIA_PAYMENT_VAULT;
    delete process.env.BASE_SEPOLIA_SUBSCRIPTION_MANAGER;

    const resolve = await loadDeployment("base-sepolia");
    expect(() => resolve(false)).toThrow(/BASE_SEPOLIA_/);
  });

  it("throws when live-mode env vars are missing", async () => {
    delete process.env.BASE_RPC_URL;
    delete process.env.BASE_PAYMENT_VAULT;
    delete process.env.BASE_SUBSCRIPTION_MANAGER;

    const resolve = await loadDeployment("base");
    expect(() => resolve(true)).toThrow(/BASE_/);
  });
});
