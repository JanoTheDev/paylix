import { describe, it, expectTypeOf, expect } from "vitest";
import type { NetworkKey, Environment, NetworkConfig, TokenConfig } from "../networks";
import { NETWORKS } from "../networks";
import { base, baseSepolia } from "viem/chains";

describe("registry types", () => {
  it("NetworkKey is exactly 'base' | 'base-sepolia'", () => {
    // toEqualTypeOf catches BOTH widening and narrowing — if a future edit
    // either broadens to `string` or drops an entry from the union, this
    // test fails to compile.
    expectTypeOf<NetworkKey>().toEqualTypeOf<"base" | "base-sepolia">();
  });

  it("Environment is exactly 'mainnet' | 'testnet'", () => {
    expectTypeOf<Environment>().toEqualTypeOf<"mainnet" | "testnet">();
  });

  it("TokenConfig has the expected required + optional shape", () => {
    // Construction assignment does the real work — all required fields must
    // be present or this fails to compile.
    const _t: TokenConfig = {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      supportsPermit: true,
      eip712Version: "2",
      isStable: true,
      address: "0x0000000000000000000000000000000000000000",
    };
    void _t;
    // Additional shape assertions that would fail if optionality changes:
    expectTypeOf<TokenConfig["decimals"]>().toEqualTypeOf<number>();
    expectTypeOf<TokenConfig["address"]>().toEqualTypeOf<
      `0x${string}` | undefined
    >();
    expectTypeOf<TokenConfig["addressEnvVar"]>().toEqualTypeOf<
      string | undefined
    >();
  });

  it("NetworkConfig.environment is Environment", () => {
    expectTypeOf<NetworkConfig["environment"]>().toEqualTypeOf<Environment>();
  });
});

describe("NETWORKS data", () => {
  it("has a base entry", () => {
    expect(NETWORKS.base).toBeDefined();
    expect(NETWORKS.base.chainId).toBe(8453);
    expect(NETWORKS.base.environment).toBe("mainnet");
    expect(NETWORKS.base.viemChain).toBe(base);
  });

  it("has a base-sepolia entry", () => {
    expect(NETWORKS["base-sepolia"]).toBeDefined();
    expect(NETWORKS["base-sepolia"].chainId).toBe(84532);
    expect(NETWORKS["base-sepolia"].environment).toBe("testnet");
    expect(NETWORKS["base-sepolia"].viemChain).toBe(baseSepolia);
  });

  it("base USDC is Circle's canonical address with version 2", () => {
    const usdc = NETWORKS.base.tokens.USDC;
    expect(usdc).toBeDefined();
    expect(usdc.address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(usdc.decimals).toBe(6);
    expect(usdc.supportsPermit).toBe(true);
    expect(usdc.eip712Version).toBe("2");
  });

  it("base-sepolia USDC is env-driven with version 1", () => {
    // Cast through TokenConfig so we can assert the optional `address` is absent
    // — the `as const` map narrows the type to a shape without that field, which
    // trips strict tsc even though vitest would pass without the cast.
    const usdc: TokenConfig = NETWORKS["base-sepolia"].tokens.USDC;
    expect(usdc).toBeDefined();
    expect(usdc.address).toBeUndefined();
    expect(usdc.addressEnvVar).toBe("NEXT_PUBLIC_MOCK_USDC_ADDRESS");
    expect(usdc.eip712Version).toBe("1");
  });

  it("every network has a unique chainId", () => {
    const chainIds = Object.values(NETWORKS).map((n) => n.chainId);
    expect(new Set(chainIds).size).toBe(chainIds.length);
  });

  it("every token has exactly one of address or addressEnvVar", () => {
    for (const network of Object.values(NETWORKS)) {
      for (const token of Object.values(network.tokens)) {
        const hasCanonical = token.address !== undefined;
        const hasEnvVar = token.addressEnvVar !== undefined;
        expect(hasCanonical !== hasEnvVar).toBe(true); // XOR
      }
    }
  });

  it("every token has decimals between 1 and 18", () => {
    for (const network of Object.values(NETWORKS)) {
      for (const token of Object.values(network.tokens)) {
        expect(token.decimals).toBeGreaterThan(0);
        expect(token.decimals).toBeLessThanOrEqual(18);
      }
    }
  });
});
