import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import type { MailDriver, SendMailInput, SendMailResult } from "../types";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean;
}

export function createSmtpDriver(cfg: SmtpConfig): MailDriver {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      try {
        const html = await render(input.react);
        const info = await transporter.sendMail({
          from: input.from,
          to: input.to,
          subject: input.subject,
          html,
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
