import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { orgScope } from "./org-scope";

// Minimal stub table — just needs `organizationId` and `livemode` columns
// that mimic Drizzle's column shape enough for orgScope to read them.
const stubTable = {
  organizationId: sql.raw("t.organization_id"),
  livemode: sql.raw("t.livemode"),
} as unknown as { organizationId: unknown; livemode: unknown };

describe("orgScope", () => {
  it("returns a truthy SQL expression for valid inputs", () => {
    const result = orgScope(stubTable as never, { organizationId: "org_1", livemode: true });
    expect(result).toBeTruthy();
  });

  it("handles both livemode values", () => {
    const live = orgScope(stubTable as never, { organizationId: "org_1", livemode: true });
    const test = orgScope(stubTable as never, { organizationId: "org_1", livemode: false });
    expect(live).toBeTruthy();
    expect(test).toBeTruthy();
  });
});
