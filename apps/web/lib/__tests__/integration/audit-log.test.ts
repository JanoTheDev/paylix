import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_ORG = { ok: true, organizationId: "org-1", userId: "user-1", session: {} };

vi.mock("@/lib/require-active-org", () => ({
  resolveActiveOrg: vi.fn().mockResolvedValue(MOCK_ORG),
}));

const mockLogEntry = {
  id: "log-1",
  organizationId: "org-1",
  userId: "user-1",
  action: "product.created",
  resourceType: "product",
  resourceId: "prod-1",
  details: { name: "Pro Plan" },
  ipAddress: "1.2.3.4",
  createdAt: new Date(),
};

const mockDb = {
  select: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

const { GET: getAuditLog } = await import("@/app/api/settings/audit-log/route");

describe("Audit Log integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recent audit entries", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockLogEntry]),
          }),
        }),
      }),
    });
    const res = await getAuditLog();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toBeDefined();
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs.length).toBe(1);
    expect(body.logs[0].action).toBe("product.created");
  });

  it("returns empty array when no logs exist", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    const res = await getAuditLog();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toEqual([]);
  });

  it("returns 401 when not authenticated", async () => {
    const { resolveActiveOrg } = await import("@/lib/require-active-org");
    const mockResolve = resolveActiveOrg as ReturnType<typeof vi.fn>;
    const { apiError } = await import("@/lib/api-error");
    mockResolve.mockResolvedValueOnce({
      ok: false,
      response: apiError("unauthorized", "Unauthorized", 401),
    });
    const res = await getAuditLog();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(typeof body.error.message).toBe("string");
  });
});
