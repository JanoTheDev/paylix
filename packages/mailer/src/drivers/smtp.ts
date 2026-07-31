import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import type { MailDriver, SendMailInput, SendMailResult } from "../types";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean;
  /**
   * Opt out of mandatory STARTTLS. Only for a trusted loopback relay — with
   * it false, credentials can be sent in the clear.
   */
  requireTls?: boolean;
}

export function createSmtpDriver(cfg: SmtpConfig): MailDriver {
  const secure = cfg.secure ?? cfg.port === 465;
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    // On submission ports (587) nodemailer only attempts STARTTLS
    // opportunistically. Against a server that doesn't advertise it — or an
    // active downgrade — SMTP_USER/SMTP_PASS go out in plaintext, so require
    // it unless the operator explicitly opts out. See IDX-37.
    requireTLS: secure ? undefined : (cfg.requireTls ?? true),
    auth: { user: cfg.user, pass: cfg.pass },
  });

  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      try {
        const html =
          "html" in input && input.html !== undefined
            ? input.html
            : await render(input.react!);
        const text = "text" in input ? input.text : undefined;
        const info = await transporter.sendMail({
          from: input.from,
          to: input.to,
          subject: input.subject,
          html,
          text,
          attachments: input.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        });
        return { ok: true, id: info.messageId };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
