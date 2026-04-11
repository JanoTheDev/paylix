import type { ReactElement } from "react";

export interface Attachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

interface BaseMailInput {
  to: string;
  from: string;
  subject: string;
  attachments?: Attachment[];
}

export type SendMailInput =
  | (BaseMailInput & { react: ReactElement; html?: never; text?: never })
  | (BaseMailInput & { html: string; text?: string; react?: never });

export interface SendMailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface MailDriver {
  send(input: SendMailInput): Promise<SendMailResult>;
}
