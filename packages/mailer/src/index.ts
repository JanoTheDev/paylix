import { selectDriver } from "./select";
import type { SendMailInput, SendMailResult } from "./types";

export type {
  SendMailInput,
  SendMailResult,
  MailDriver,
  Attachment,
} from "./types";

let driverPromise: ReturnType<typeof selectDriver> | null = null;

export async function sendMail(
  input: SendMailInput,
): Promise<SendMailResult> {
  if (!driverPromise) driverPromise = selectDriver();
  const driver = await driverPromise;
  return driver.send(input);
}

export { selectDriver };
export { renderTemplate } from "./render";
