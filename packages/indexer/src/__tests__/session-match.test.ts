import { describe, it, expect, vi, beforeEach } from "vitest";
import { findSessionByCustomerId, hashSessionId } from "../session-match";

type Row = { id: string };

function page(ids: string[]): Row[] {
  return ids.map((id) => ({ id }));
}

describe("findSessionByCustomerId", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("matches a session on the first page", async () => {
    const fetchPage = vi.fn(async () => page(["a", "b", "target"]));
    const hit = await findSessionByCustomerId({
      targetCustomerId: hashSessionId("target"),
      fetchPage,
      pageSize: 3,
    });
    expect(hit?.id).toBe("target");
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("keeps paging past the first page instead of truncating", async () => {
    // The bug this fixes: a merchant with more than one page of open sessions
    // could never match a valid payment, because the scan stopped at 200 rows
    // and every replay re-ran the identical bounded scan.
    const pages = [page(["a", "b"]), page(["c", "d"]), page(["e", "target"])];
    const fetchPage = vi.fn(async (_limit: number, offset: number) =>
      pages[offset / 2] ?? [],
    );

    const hit = await findSessionByCustomerId({
      targetCustomerId: hashSessionId("target"),
      fetchPage,
      pageSize: 2,
    });

    expect(hit?.id).toBe("target");
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenLastCalledWith(2, 4);
  });

  it("is case-insensitive about the on-chain customerId", async () => {
    const fetchPage = vi.fn(async () => page(["target"]));
    const hit = await findSessionByCustomerId({
      targetCustomerId: hashSessionId("target").toUpperCase(),
      fetchPage,
      pageSize: 1,
    });
    expect(hit?.id).toBe("target");
  });

  it("stops at a short page (end of the candidate set)", async () => {
    const fetchPage = vi.fn(async (_limit: number, offset: number) =>
      offset === 0 ? page(["a"]) : page([]),
    );
    const hit = await findSessionByCustomerId({
      targetCustomerId: hashSessionId("nope"),
      fetchPage,
      pageSize: 2,
    });
    expect(hit).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("returns null on an empty candidate set without paging further", async () => {
    const fetchPage = vi.fn(async () => page([]));
    const hit = await findSessionByCustomerId({
      targetCustomerId: hashSessionId("nope"),
      fetchPage,
      pageSize: 2,
    });
    expect(hit).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("bounds the scan at maxPages and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchPage = vi.fn(async () => page(["x", "y"]));
    const hit = await findSessionByCustomerId({
      targetCustomerId: hashSessionId("target"),
      fetchPage,
      pageSize: 2,
      maxPages: 3,
    });
    expect(hit).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalled();
  });
});
