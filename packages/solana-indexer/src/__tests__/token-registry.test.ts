import { describe, it, expect } from "vitest";
import { resolveMint } from "../token-registry";

describe("resolveMint", () => {
  it("resolves USDC on mainnet", () => {
    expect(resolveMint("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toEqual({
      symbol: "USDC",
      decimals: 6,
    });
  });

  it("resolves USDT on mainnet", () => {
    expect(resolveMint("solana", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")).toEqual({
      symbol: "USDT",
      decimals: 6,
    });
  });

  it("resolves PYUSD on mainnet", () => {
    expect(resolveMint("solana", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo")).toEqual({
      symbol: "PYUSD",
      decimals: 6,
    });
  });

  it("resolves USDC on devnet", () => {
    expect(resolveMint("solana-devnet", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")).toEqual({
      symbol: "USDC",
      decimals: 6,
    });
  });

  it("throws on an unrecognized mint", () => {
    expect(() => resolveMint("solana", "11111111111111111111111111111111")).toThrow(
      /unrecognized mint/i,
    );
  });

  it("throws with the mint address in the message for debuggability", () => {
    expect(() => resolveMint("solana", "BadMint111111111111111111111111111111111")).toThrow(
      /BadMint111111111111111111111111111111111/,
    );
  });
});
