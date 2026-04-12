import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_ORG = { ok: true, organizationId: "org-1", userId: "user-1", session: {} };

vi.mock("@/lib/require-active-org", () => ({
  resolveActiveOrg: vi.fn().mockResolvedValue(MOCK_ORG),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/url-safety", () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(null),
}));

const mockWebhook = {
  id: "wh-1",
  organizationId: "org-1",
  url: "https://example.com/hook",
  secret: "whsec_abc123",
  events: ["payment.confirmed"],
  isActive: true,
  createdAt: new Date(),
};

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

const { GET: listWebhooks, POST: createWebhook } = await import(
  "@/app/api/webhooks/route"
);
const { PATCH: updateWebhook, DELETE: deleteWebhook, GET: getWebhook } = await import(
  "@/app/api/webhooks/[id]/route"
);

function json(body: unknown) {
  return new Request("http://test/api/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Webhooks API integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a webhook with secret", async () => {
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockWebhook]),
      }),
    });
    const res = await createWebhook(
      json({ url: "https://example.com/hook", events: ["payment.confirmed"] }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("wh-1");
    expect(body.secret).toBeDefined();
    expect(body.url).toBe("https://example.com/hook");
  });

  it("lists webhooks", async () => {
    const { secret: _s, ...safeRow } = mockWebhook;
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([safeRow]),
        }),
      }),
    });
    const res = await listWebhooks();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  it("gets a single webhook by id", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockWebhook]),
      }),
    });
    const res = await getWebhook(
      new Request("http://test/api/webhooks/wh-1"),
      { params: Promise.resolve({ id: "wh-1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("wh-1");
  });

  it("returns 404 for nonexistent webhook GET", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    const res = await getWebhook(
      new Request("http://test/api/webhooks/nope"),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.message).toBe("string");
  });

  it("updates a webhook URL", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...mockWebhook, url: "https://new.example.com" }]),
        }),
      }),
    });
    const req = new Request("http://test/api/webhooks/wh-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://new.example.com" }),
    });
    const res = await updateWebhook(req, { params: Promise.resolve({ id: "wh-1" }) });
    expect(res.status).toBe(200);
  });

  it("returns 404 when updating nonexistent webhook", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const req = new Request("http://test/api/webhooks/nope", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://x.com" }),
    });
    const res = await updateWebhook(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("deletes a webhook", async () => {
    mockDb.delete.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockWebhook]),
      }),
    });
    const req = new Request("http://test/api/webhooks/wh-1", { method: "DELETE" });
    const res = await deleteWebhook(req, { params: Promise.resolve({ id: "wh-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 when deleting nonexistent webhook", async () => {
    mockDb.delete.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });
    const req = new Request("http://test/api/webhooks/nope", { method: "DELETE" });
    const res = await deleteWebhook(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.message).toBe("string");
  });

  it("rejects webhook creation with invalid body", async () => {
    const res = await createWebhook(json({ url: "not-a-url" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(typeof body.error.message).toBe("string");
  });

  it("rejects webhook creation with no events", async () => {
    const res = await createWebhook(json({ url: "https://example.com", events: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });
});
