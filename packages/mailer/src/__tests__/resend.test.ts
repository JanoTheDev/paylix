import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { createResendDriver } from "../drivers/resend";

const sendSpy = vi.fn(async () => ({
  data: { id: "resend-456" },
  error: null,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendSpy };
  },
}));

vi.mock("@react-email/render", () => ({
  render: vi.fn(async () => "<p>hello</p>"),
}));

describe("resend driver", () => {
  it("sends via resend SDK and returns ok with id", async () => {
    const driver = createResendDriver({ apiKey: "key" });
    const result = await driver.send({
      to: "a@b.com",
      from: "noreply@x.com",
      subject: "Hi",
      react: createElement("div", null, "hello"),
    });
    expect(result.ok).toBe(true);
    expect(result.id).toBe("resend-456");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("returns error when resend errors", async () => {
    sendSpy.mockResolvedValueOnce({
      data: null,
      error: { message: "bounced" },
    } as unknown as { data: null; error: { message: string } });
    const driver = createResendDriver({ apiKey: "key" });
    const result = await driver.send({
      to: "a@b.com",
      from: "noreply@x.com",
      subject: "Hi",
      react: createElement("div", null, "hello"),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("bounced");
  });
});
