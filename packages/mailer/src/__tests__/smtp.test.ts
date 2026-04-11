import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { createSmtpDriver } from "../drivers/smtp";

vi.mock("nodemailer", () => {
  return {
    default: {
      createTransport: () => ({
        sendMail: vi.fn(async (opts: { html: string }) => ({
          messageId: "smtp-123",
          response: opts.html,
        })),
      }),
    },
  };
});

vi.mock("@react-email/render", () => ({
  render: vi.fn(async () => "<p>hello</p>"),
}));

describe("smtp driver", () => {
  it("renders react to html and returns ok with id", async () => {
    const driver = createSmtpDriver({
      host: "smtp.example.com",
      port: 587,
      user: "u",
      pass: "p",
    });
    const result = await driver.send({
      to: "a@b.com",
      from: "noreply@x.com",
      subject: "Hi",
      react: createElement("div", null, "hello"),
    });
    expect(result.ok).toBe(true);
    expect(result.id).toBe("smtp-123");
  });
});
