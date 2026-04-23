import { describe, it, expectTypeOf, expect, afterEach } from "vitest";
import type { NetworkKey, Environment, NetworkConfig, TokenConfig } from "../networks";
import {
  NETWORKS,
  getActiveNetwork,
  getAvailableNetworks,
  getAllNetworks,
  resolveTokenAddress,
  assertValidNetworkKey,
  assertValidTokenSymbol,
  getToken,
  isTokenUsable,
  getUsableTokens,
} from "../networks";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from "viem/chains";

describe("registry types", () => {
  it("Environment is exactly 'mainnet' | 'testnet'", () => {
    expectTypeOf<Environment>().toEqualTypeOf<"mainnet" | "testnet">();
  });

  it("NetworkKey is a string literal union, not `string`", () => {
    // Assigning a plain string must fail — if NetworkKey ever widens to
    // `string` this line starts compiling and the check is dead.
    // @ts-expect-error — arbitrary string is not a NetworkKey
    const _impossible: NetworkKey = "not-a-real-network";
    void _impossible;
  });

  it("NetworkKey contains the known chain keys", () => {
    const sample: NetworkKey[] = [
      "ethereum",
      "base",
      "arbitrum",
      "optimism",
      "polygon",
      "bnb",
      "avalanche",
      "ethereum-sepolia",
      "base-sepolia",
      "arbitrum-sepolia",
      "op-sepolia",
      "polygon-amoy",
      "bnb-testnet",
      "avalanche-fuji",
    ];
    for (const k of sample) expect(NETWORKS[k]).toBeDefined();
  });

  it("TokenConfig has the expected required + optional shape", () => {
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
    expectTypeOf<TokenConfig["decimals"]>().toEqualTypeOf<number>();
    expectTypeOf<TokenConfig["address"]>().toEqualTypeOf<
      `0x${string}` | undefined
    >();
    expectTypeOf<TokenConfig["addressEnvVar"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<TokenConfig["bridged"]>().toEqualTypeOf<boolean | undefined>();
  });

  it("NetworkConfig.environment is Environment", () => {
    expectTypeOf<NetworkConfig["environment"]>().toEqualTypeOf<Environment>();
  });
});

describe("NETWORKS data — chain identity", () => {
  const expectedChains: Array<[NetworkKey, number, Environment, unknown]> = [
    ["ethereum", 1, "mainnet", mainnet],
    ["base", 8453, "mainnet", base],
    ["arbitrum", 42161, "mainnet", arbitrum],
    ["optimism", 10, "mainnet", optimism],
    ["polygon", 137, "mainnet", polygon],
    ["bnb", 56, "mainnet", bsc],
    ["avalanche", 43114, "mainnet", avalanche],
    ["ethereum-sepolia", 11155111, "testnet", sepolia],
    ["base-sepolia", 84532, "testnet", baseSepolia],
    ["arbitrum-sepolia", 421614, "testnet", arbitrumSepolia],
    ["op-sepolia", 11155420, "testnet", optimismSepolia],
    ["polygon-amoy", 80002, "testnet", polygonAmoy],
    ["bnb-testnet", 97, "testnet", bscTestnet],
    ["avalanche-fuji", 43113, "testnet", avalancheFuji],
  ];

  for (const [key, chainId, environment, viemChain] of expectedChains) {
    it(`${key} has the correct chainId, environment, viemChain`, () => {
      expect(NETWORKS[key].chainId).toBe(chainId);
      expect(NETWORKS[key].environment).toBe(environment);
      expect(NETWORKS[key].viemChain).toBe(viemChain);
    });
  }

  it("every network has a unique chainId", () => {
    const chainIds = Object.values(NETWORKS).map((n) => n.chainId);
    expect(new Set(chainIds).size).toBe(chainIds.length);
  });

  it("every network has at least one token", () => {
    for (const network of Object.values(NETWORKS)) {
      expect(Object.keys(network.tokens).length).toBeGreaterThan(0);
    }
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

  it("every canonical address passes the 0x+40 hex regex", () => {
    for (const network of Object.values(NETWORKS)) {
      for (const token of Object.values(network.tokens)) {
        if (token.address) {
          expect(token.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        }
      }
    }
  });
});

describe("NETWORKS data — token specifics", () => {
  it("base USDC is Circle's canonical address with version 2", () => {
    const usdc = NETWORKS.base.tokens.USDC;
    expect(usdc.address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(usdc.decimals).toBe(6);
    expect(usdc.supportsPermit).toBe(true);
    expect(usdc.eip712Version).toBe("2");
  });

  it("base-sepolia USDC is env-driven with version 1", () => {
    const usdc: TokenConfig = NETWORKS["base-sepolia"].tokens.USDC;
    expect(usdc.address).toBeUndefined();
    expect(usdc.addressEnvVar).toBe("NEXT_PUBLIC_MOCK_USDC_ADDRESS");
    expect(usdc.eip712Version).toBe("1");
  });

  it("bnb USDC is flagged bridged and non-permit (18 decimals)", () => {
    const usdc = NETWORKS.bnb.tokens.USDC;
    expect(usdc.bridged).toBe(true);
    expect(usdc.supportsPermit).toBe(false);
    expect(usdc.decimals).toBe(18);
  });

  it("all mainnet USDC entries (except BNB) are permit-capable 6-decimal", () => {
    const mainnetKeys: NetworkKey[] = [
      "ethereum",
      "base",
      "arbitrum",
      "optimism",
      "polygon",
      "avalanche",
    ];
    for (const k of mainnetKeys) {
      const usdc = NETWORKS[k].tokens.USDC;
      expect(usdc.supportsPermit).toBe(true);
      expect(usdc.decimals).toBe(6);
      expect(usdc.address).toBeDefined();
    }
  });

  it("every testnet USDC uses a distinct addressEnvVar", () => {
    const envVars = Object.values(NETWORKS)
      .filter((n) => n.environment === "testnet")
      .map((n) => n.tokens.USDC.addressEnvVar);
    expect(envVars.every((v) => v !== undefined)).toBe(true);
    expect(new Set(envVars).size).toBe(envVars.length);
  });
});

describe("NETWORKS data — signatureScheme invariants", () => {
  it("every token has a valid signatureScheme", () => {
    const valid = new Set(["eip2612", "permit2", "dai-permit", "none"]);
    for (const network of Object.values(NETWORKS)) {
      for (const token of Object.values(network.tokens)) {
        expect(valid.has(token.signatureScheme)).toBe(true);
      }
    }
  });

  it("signatureScheme=eip2612 ⇔ supportsPermit=true", () => {
    for (const network of Object.values(NETWORKS)) {
      for (const token of Object.values(network.tokens)) {
        const is2612 = token.signatureScheme === "eip2612";
        expect(is2612).toBe(token.supportsPermit);
      }
    }
  });

  it("USDC on major EVM mainnets uses eip2612", () => {
    const keys: NetworkKey[] = [
      "ethereum",
      "base",
      "arbitrum",
      "optimism",
      "polygon",
      "avalanche",
    ];
    for (const k of keys) {
      expect(NETWORKS[k].tokens.USDC.signatureScheme).toBe("eip2612");
    }
  });

  it("USDT across all supported chains uses permit2", () => {
    const chainsWithUSDT = Object.values(NETWORKS).filter((n) => n.tokens.USDT);
    expect(chainsWithUSDT.length).toBeGreaterThan(0);
    for (const n of chainsWithUSDT) {
      expect(n.tokens.USDT.signatureScheme).toBe("permit2");
    }
  });

  it("DAI on Ethereum mainnet uses dai-permit", () => {
    expect(NETWORKS.ethereum.tokens.DAI.signatureScheme).toBe("dai-permit");
  });

  it("DAI on L2s uses permit2 (not dai-permit)", () => {
    const l2Keys: NetworkKey[] = ["base", "arbitrum", "optimism", "polygon", "avalanche"];
    for (const k of l2Keys) {
      const dai = NETWORKS[k].tokens.DAI;
      if (dai) expect(dai.signatureScheme).toBe("permit2");
    }
  });

  it("bridged tokens are explicitly flagged", () => {
    const bridgedEntries = Object.values(NETWORKS).flatMap((n) =>
      Object.values(n.tokens).filter((t) => t.bridged),
    );
    // We've got bridged USDC on BNB plus bridged WETH/DAI on several L2s.
    expect(bridgedEntries.length).toBeGreaterThan(0);
  });

  it("WETH canonical deployments have the expected addresses", () => {
    expect(NETWORKS.ethereum.tokens.WETH.address).toBe(
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    );
    expect(NETWORKS.base.tokens.WETH.address).toBe(
      "0x4200000000000000000000000000000000000006",
    );
    expect(NETWORKS.optimism.tokens.WETH.address).toBe(
      "0x4200000000000000000000000000000000000006",
    );
  });

  it("WBTC deployments have 8 decimals", () => {
    for (const n of Object.values(NETWORKS)) {
      const wbtc = n.tokens.WBTC;
      if (wbtc) expect(wbtc.decimals).toBe(8);
    }
  });

  it("every non-stable token on a mainnet can eventually be used (scheme != 'none')", () => {
    for (const n of Object.values(NETWORKS)) {
      if (n.environment !== "mainnet") continue;
      for (const t of Object.values(n.tokens)) {
        // Everything we've added except the BNB bridged USDC should be routable.
        if (n.key === "bnb" && t.symbol === "USDC") continue;
        expect(t.signatureScheme).not.toBe("none");
      }
    }
  });

  it("Ethereum hosts the expected core stablecoins", () => {
    const eth = NETWORKS.ethereum;
    expect(eth.tokens.USDC).toBeDefined();
    expect(eth.tokens.USDT).toBeDefined();
    expect(eth.tokens.DAI).toBeDefined();
    expect(eth.tokens.PYUSD).toBeDefined();
  });
});

describe("getActiveNetwork", () => {
  const originalEnv = process.env.NEXT_PUBLIC_NETWORK;
  afterEach(() => {
    process.env.NEXT_PUBLIC_NETWORK = originalEnv;
  });

  it("returns the network matching NEXT_PUBLIC_NETWORK", () => {
    process.env.NEXT_PUBLIC_NETWORK = "base";
    expect(getActiveNetwork().key).toBe("base");
  });

  it("works for newly-added chains", () => {
    process.env.NEXT_PUBLIC_NETWORK = "arbitrum";
    expect(getActiveNetwork().key).toBe("arbitrum");
    process.env.NEXT_PUBLIC_NETWORK = "polygon-amoy";
    expect(getActiveNetwork().key).toBe("polygon-amoy");
  });

  it("throws with a clear message on unknown key", () => {
    process.env.NEXT_PUBLIC_NETWORK = "solana";
    expect(() => getActiveNetwork()).toThrow(/solana/);
    expect(() => getActiveNetwork()).toThrow(/base/);
  });

  it("throws when NEXT_PUBLIC_NETWORK is unset", () => {
    delete process.env.NEXT_PUBLIC_NETWORK;
    expect(() => getActiveNetwork()).toThrow();
  });
});

describe("getAvailableNetworks", () => {
  const originalEnv = process.env.NEXT_PUBLIC_NETWORK;
  afterEach(() => {
    process.env.NEXT_PUBLIC_NETWORK = originalEnv;
  });

  it("on a mainnet deploy, returns only mainnet networks", () => {
    process.env.NEXT_PUBLIC_NETWORK = "base";
    const list = getAvailableNetworks();
    expect(list.length).toBeGreaterThan(0);
    for (const n of list) expect(n.environment).toBe("mainnet");
  });

  it("on a testnet deploy, returns only testnet networks", () => {
    process.env.NEXT_PUBLIC_NETWORK = "base-sepolia";
    const list = getAvailableNetworks();
    expect(list.length).toBeGreaterThan(0);
    for (const n of list) expect(n.environment).toBe("testnet");
  });

  it("testnet deploy never sees mainnet entries", () => {
    process.env.NEXT_PUBLIC_NETWORK = "base-sepolia";
    const keys = getAvailableNetworks().map((n) => n.key);
    expect(keys).not.toContain("base");
    expect(keys).not.toContain("arbitrum");
    expect(keys).not.toContain("polygon");
  });

  it("mainnet deploy never sees testnet entries", () => {
    process.env.NEXT_PUBLIC_NETWORK = "base";
    const keys = getAvailableNetworks().map((n) => n.key);
    expect(keys).not.toContain("base-sepolia");
    expect(keys).not.toContain("polygon-amoy");
  });

  it("mainnet deploy surfaces all 7 mainnet chains", () => {
    process.env.NEXT_PUBLIC_NETWORK = "base";
    const keys = getAvailableNetworks().map((n) => n.key).sort();
    expect(keys).toEqual(
      [
        "arbitrum",
        "avalanche",
        "base",
        "bnb",
        "ethereum",
        "optimism",
        "polygon",
      ].sort(),
    );
  });

  it("testnet deploy surfaces all 7 testnet chains", () => {
    process.env.NEXT_PUBLIC_NETWORK = "base-sepolia";
    const keys = getAvailableNetworks().map((n) => n.key).sort();
    expect(keys).toEqual(
      [
        "arbitrum-sepolia",
        "avalanche-fuji",
        "base-sepolia",
        "bnb-testnet",
        "ethereum-sepolia",
        "op-sepolia",
        "polygon-amoy",
      ].sort(),
    );
  });
});

describe("resolveTokenAddress", () => {
  const originalMock = process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS;
  afterEach(() => {
    process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS = originalMock;
  });

  it("returns the canonical address for tokens with a hardcoded address", () => {
    const usdc = NETWORKS.base.tokens.USDC;
    expect(resolveTokenAddress(usdc)).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
  });

  it("reads from env for tokens with addressEnvVar", () => {
    process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS =
      "0xABCdef0123456789ABCdef0123456789ABCdef01";
    const usdc = NETWORKS["base-sepolia"].tokens.USDC;
    expect(resolveTokenAddress(usdc)).toBe(
      "0xABCdef0123456789ABCdef0123456789ABCdef01",
    );
  });

  it("throws when the env var is unset", () => {
    delete process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS;
    const usdc = NETWORKS["base-sepolia"].tokens.USDC;
    expect(() => resolveTokenAddress(usdc)).toThrow(
      /NEXT_PUBLIC_MOCK_USDC_ADDRESS/,
    );
  });

  it("throws when the env var is the zero address", () => {
    process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS =
      "0x0000000000000000000000000000000000000000";
    const usdc = NETWORKS["base-sepolia"].tokens.USDC;
    expect(() => resolveTokenAddress(usdc)).toThrow(
      /NEXT_PUBLIC_MOCK_USDC_ADDRESS/,
    );
  });
});

describe("assertValidNetworkKey", () => {
  it("passes for known keys", () => {
    expect(() => assertValidNetworkKey("base")).not.toThrow();
    expect(() => assertValidNetworkKey("arbitrum")).not.toThrow();
    expect(() => assertValidNetworkKey("polygon-amoy")).not.toThrow();
  });

  it("throws on unknown keys", () => {
    expect(() => assertValidNetworkKey("solana")).toThrow(/solana/);
    expect(() => assertValidNetworkKey("")).toThrow();
  });

  it("narrows the type to NetworkKey (compile-time check)", () => {
    const input: string = "base";
    assertValidNetworkKey(input);
    const _k: NetworkKey = input;
    expect(_k).toBe("base");
  });
});

describe("assertValidTokenSymbol", () => {
  it("passes for known symbols on a network", () => {
    expect(() =>
      assertValidTokenSymbol(NETWORKS.base, "USDC"),
    ).not.toThrow();
  });

  it("throws for unknown symbols", () => {
    expect(() =>
      assertValidTokenSymbol(NETWORKS.base, "DOGE"),
    ).toThrow(/DOGE/);
  });
});

describe("getToken", () => {
  it("returns the token config for (network, symbol)", () => {
    const t = getToken("base", "USDC");
    expect(t.symbol).toBe("USDC");
    expect(t.decimals).toBe(6);
  });

  it("works for newly-added chains", () => {
    const t = getToken("arbitrum", "USDC");
    expect(t.address).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
  });

  it("throws on unknown network", () => {
    expect(() => getToken("solana" as NetworkKey, "USDC")).toThrow();
  });

  it("throws on unknown symbol", () => {
    expect(() => getToken("base", "DOGE")).toThrow(/DOGE/);
  });
});

describe("isTokenUsable + getUsableTokens", () => {
  it("eip2612 tokens are currently usable", () => {
    expect(isTokenUsable(NETWORKS.base.tokens.USDC)).toBe(true);
    expect(isTokenUsable(NETWORKS.ethereum.tokens.PYUSD)).toBe(true);
  });

  it("permit2 tokens are currently inert (relay not dispatched yet)", () => {
    expect(isTokenUsable(NETWORKS.ethereum.tokens.USDT)).toBe(false);
    expect(isTokenUsable(NETWORKS.ethereum.tokens.WETH)).toBe(false);
  });

  it("dai-permit tokens are currently inert", () => {
    expect(isTokenUsable(NETWORKS.ethereum.tokens.DAI)).toBe(false);
  });

  it("none-scheme tokens are never usable", () => {
    expect(isTokenUsable(NETWORKS.bnb.tokens.USDC)).toBe(false);
  });

  it("getUsableTokens filters to the active set per network", () => {
    const ethTokens = getUsableTokens(NETWORKS.ethereum);
    const symbols = ethTokens.map((t) => t.symbol).sort();
    expect(symbols).toEqual(["PYUSD", "USDC"]);
  });
});

describe("getAllNetworks", () => {
  it("returns every network (14 after the EVM-7 expansion)", () => {
    const result = getAllNetworks();
    expect(result.length).toBe(14);
  });

  it("includes both mainnet and testnet networks", () => {
    const envs = new Set(getAllNetworks().map((n) => n.environment));
    expect(envs.has("mainnet")).toBe(true);
    expect(envs.has("testnet")).toBe(true);
  });

  it("has equal counts of mainnet and testnet entries", () => {
    const list = getAllNetworks();
    const mainnets = list.filter((n) => n.environment === "mainnet");
    const testnets = list.filter((n) => n.environment === "testnet");
    expect(mainnets.length).toBe(testnets.length);
  });
});
