import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_ORG = { ok: true, organizationId: "org-1", userId: "user-1", session: {} };

vi.mock("@/lib/require-active-org", () => ({
  resolveActiveOrg: vi.fn().mockResolvedValue(MOCK_ORG),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

let capturedGenerateType: string | undefined;

vi.mock("@/lib/api-key-utils", () => ({
  generateApiKey: vi.fn().mockImplementation((type: string) => {
    capturedGenerateType = type;
    const prefix = type === "publishable" ? "pk_test_" : "sk_test_";
    return {
      key: `${prefix}abcdefghij1234567890abcd`,
      prefix: `${prefix}abcd`,
      hash: "sha256hash",
    };
  }),
}));

const mockKeyRow = {
  id: "key-1",
  organizationId: "org-1",
  name: "Test Key",
  prefix: "pk_test_abcd",
  type: "publishable",
  keyHash: "sha256hash",
  isActive: true,
  lastUsedAt: null,
  createdAt: new Date(),
};

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

const { GET: listKeys, POST: createKey } = await import("@/app/api/keys/route");
const { DELETE: revokeKey } = await import("@/app/api/keys/[id]/route");

function json(body: unknown) {
  return new Request("http://test/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API Keys integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedGenerateType = undefined;
  });

  it("creates a publishable key starting with pk_", async () => {
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockKeyRow]),
      }),
    });
    const res = await createKey(json({ name: "My Key", type: "publishable" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^pk_/);
    expect(capturedGenerateType).toBe("publishable");
  });

  it("creates a secret key starting with sk_", async () => {
    const secretRow = { ...mockKeyRow, type: "secret", prefix: "sk_test_abcd" };
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([secretRow]),
      }),
    });
    const res = await createKey(json({ name: "Secret Key", type: "secret" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^sk_/);
    expect(capturedGenerateType).toBe("secret");
  });

  it("lists keys for the org", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([mockKeyRow]),
        }),
      }),
    });
    const res = await listKeys();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].prefix).toBeDefined();
  });

  it("revokes a key", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...mockKeyRow, isActive: false }]),
        }),
      }),
    });
    const req = new Request("http://test/api/keys/key-1", { method: "DELETE" });
    const res = await revokeKey(req, { params: Promise.resolve({ id: "key-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 when revoking nonexistent key", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const req = new Request("http://test/api/keys/nope", { method: "DELETE" });
    const res = await revokeKey(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.message).toBe("string");
  });

  it("rejects key creation with invalid type", async () => {
    const res = await createKey(json({ name: "Bad", type: "admin" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(typeof body.error.message).toBe("string");
  });

  it("rejects key creation with missing name", async () => {
    const res = await createKey(json({ type: "publishable" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });
});
