import { Resend } from "resend";
import { render } from "@react-email/render";
import type { MailDriver, SendMailInput, SendMailResult } from "../types";

export interface ResendConfig {
  apiKey: string;
}

export function createResendDriver(cfg: ResendConfig): MailDriver {
  const client = new Resend(cfg.apiKey);

  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      try {
        const html =
          "html" in input && input.html !== undefined
            ? input.html
            : await render(input.react!);
        const text = "text" in input ? input.text : undefined;
        const { data, error } = await client.emails.send({
          from: input.from,
          to: input.to,
          subject: input.subject,
          html,
          text,
          attachments: input.attachments?.map((a) => ({
            filename: a.filename,
            content:
              typeof a.content === "string"
                ? a.content
                : a.content.toString("base64"),
          })),
        });
        if (error) {
          return { ok: false, error: error.message };
        }
        return { ok: true, id: data?.id };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
