import { describe, it, expect } from "vitest";
import { parseModeCookie } from "./request-mode";

describe("parseModeCookie", () => {
  it("returns 'live' when cookie value is 'live'", () => {
    expect(parseModeCookie("live")).toBe("live");
  });

  it("returns 'test' when cookie value is 'test'", () => {
    expect(parseModeCookie("test")).toBe("test");
  });

  it("defaults to 'test' when cookie is missing", () => {
    expect(parseModeCookie(undefined)).toBe("test");
  });

  it("defaults to 'test' for unknown values", () => {
    expect(parseModeCookie("production")).toBe("test");
    expect(parseModeCookie("")).toBe("test");
    expect(parseModeCookie("TEST")).toBe("test");
  });
});
