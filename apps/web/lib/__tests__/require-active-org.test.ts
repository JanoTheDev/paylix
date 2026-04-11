import { describe, it, expect } from "vitest";
import { requireActiveOrg } from "../require-active-org";

describe("requireActiveOrg", () => {
  it("throws 401 when session is null", () => {
    expect(() => requireActiveOrg(null)).toThrow(/Unauthorized/);
  });

  it("throws 400 when activeOrganizationId is missing", () => {
    expect(() =>
      requireActiveOrg({
        user: { id: "u1" },
        session: { id: "s1", userId: "u1", activeOrganizationId: null },
      } as Parameters<typeof requireActiveOrg>[0]),
    ).toThrow(/active team/i);
  });

  it("returns organizationId when present", () => {
    expect(
      requireActiveOrg({
        user: { id: "u1" },
        session: {
          id: "s1",
          userId: "u1",
          activeOrganizationId: "org_123",
        },
      } as Parameters<typeof requireActiveOrg>[0]),
    ).toBe("org_123");
  });
});
