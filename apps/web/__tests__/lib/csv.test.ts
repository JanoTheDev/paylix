import { describe, it, expect } from "vitest";
import {
  formatCell,
  toCsvRow,
  toCsvLine,
  metadataCells,
  metadataKeys,
} from "../../lib/csv";

describe("formatCell", () => {
  it("null/undefined → empty", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
  });

  it("basic string passes through", () => {
    expect(formatCell("hello")).toBe("hello");
  });

  it("string with comma gets quoted", () => {
    expect(formatCell("a,b")).toBe('"a,b"');
  });

  it("string with quote has quotes doubled", () => {
    expect(formatCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("string with newline gets quoted", () => {
    expect(formatCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("numbers + bigints + booleans", () => {
    expect(formatCell(42)).toBe("42");
    expect(formatCell(BigInt("1000000"))).toBe("1000000");
    expect(formatCell(true)).toBe("true");
  });

  it("Date → ISO", () => {
    expect(formatCell(new Date("2026-04-22T12:00:00Z"))).toBe(
      "2026-04-22T12:00:00.000Z",
    );
  });
});

describe("toCsvRow / toCsvLine", () => {
  it("joins cells with commas", () => {
    expect(toCsvRow(["a", "b", "c"])).toBe("a,b,c");
  });

  it("toCsvLine appends CRLF", () => {
    expect(toCsvLine(["a", "b"])).toBe("a,b\r\n");
  });

  it("escapes mixed row", () => {
    expect(toCsvRow(["id", 'say "hi"', null, 42])).toBe(
      'id,"say ""hi""",,42',
    );
  });
});

describe("metadataKeys + metadataCells", () => {
  it("unions + sorts keys across rows", () => {
    const rows: Array<{ metadata?: Record<string, string> | null }> = [
      { metadata: { plan: "pro", ref: "tw" } },
      { metadata: { plan: "free" } },
      { metadata: null },
    ];
    expect(metadataKeys(rows)).toEqual(["plan", "ref"]);
  });

  it("lines up cells against the key order, filling missing with null", () => {
    const keys = ["plan", "ref"];
    expect(metadataCells({ plan: "pro" }, keys)).toEqual(["pro", null]);
    expect(metadataCells(null, keys)).toEqual([null, null]);
  });
});
