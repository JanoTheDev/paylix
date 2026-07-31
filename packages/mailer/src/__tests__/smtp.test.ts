import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { createSmtpDriver } from "../drivers/smtp";

const transportOptions: Array<Record<string, unknown>> = [];

vi.mock("nodemailer", () => {
  return {
    default: {
      createTransport: (opts: Record<string, unknown>) => {
        transportOptions.push(opts);
        return {
          sendMail: vi.fn(async (sendOpts: { html: string }) => ({
            messageId: "smtp-123",
            response: sendOpts.html,
          })),
        };
      },
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

  it("requires STARTTLS on a non-implicit-TLS port", () => {
    transportOptions.length = 0;
    createSmtpDriver({ host: "smtp.example.com", port: 587, user: "u", pass: "p" });
    expect(transportOptions[0]).toMatchObject({ secure: false, requireTLS: true });
  });

  it("does not force STARTTLS on the implicit-TLS port 465", () => {
    transportOptions.length = 0;
    createSmtpDriver({ host: "smtp.example.com", port: 465, user: "u", pass: "p" });
    expect(transportOptions[0]).toMatchObject({ secure: true });
    expect(transportOptions[0].requireTLS).toBeUndefined();
  });

  it("lets an operator opt out for a trusted relay", () => {
    transportOptions.length = 0;
    createSmtpDriver({
      host: "127.0.0.1",
      port: 25,
      user: "u",
      pass: "p",
      requireTls: false,
    });
    expect(transportOptions[0]).toMatchObject({ secure: false, requireTLS: false });
  });
});
