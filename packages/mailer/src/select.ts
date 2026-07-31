import type { MailDriver } from "./types";

function noopDriver(): MailDriver {
  return {
    async send() {
      return {
        ok: false,
        error:
          "MAIL_DRIVER is not set. Emails will not be delivered. Configure MAIL_DRIVER=resend or MAIL_DRIVER=smtp.",
      };
    },
  };
}

let warnedUnconfigured = false;

export async function selectDriver(): Promise<MailDriver> {
  const driver = process.env.MAIL_DRIVER;
  if (!driver) {
    // Degrading to a silent no-op leaves an operator with zero emails and
    // zero visible errors — say so once, loudly, at first use (IDX-31).
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[mailer] MAIL_DRIVER is not set — no email will be delivered. " +
          "Set MAIL_DRIVER=resend or MAIL_DRIVER=smtp.",
      );
    }
    return noopDriver();
  }

  if (driver === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("MAIL_DRIVER=resend but RESEND_API_KEY is not set");
    }
    const { createResendDriver } = await import("./drivers/resend");
    return createResendDriver({ apiKey });
  }

  if (driver === "smtp") {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !port || !user || !pass) {
      throw new Error(
        "MAIL_DRIVER=smtp requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS",
      );
    }
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      throw new Error(`SMTP_PORT must be a valid port number, got "${port}"`);
    }
    const { createSmtpDriver } = await import("./drivers/smtp");
    return createSmtpDriver({
      host,
      port: parsedPort,
      user,
      pass,
      // Escape hatch for operators on a trusted loopback relay.
      requireTls: process.env.SMTP_REQUIRE_TLS !== "false",
    });
  }

  throw new Error(`Unknown MAIL_DRIVER: ${driver}`);
}
