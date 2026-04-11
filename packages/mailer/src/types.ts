import type { ReactElement } from "react";

export interface Attachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendMailInput {
  to: string;
  from: string;
  subject: string;
  react: ReactElement;
  attachments?: Attachment[];
}

export interface SendMailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface MailDriver {
  send(input: SendMailInput): Promise<SendMailResult>;
}
