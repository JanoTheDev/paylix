import { selectDriver } from "./select";
import type { SendMailInput, SendMailResult } from "./types";

export type {
  SendMailInput,
  SendMailResult,
  MailDriver,
  Attachment,
} from "./types";

let driverPromise: ReturnType<typeof selectDriver> | null = null;

/**
 * `SendMailResult` is the contract: callers get `{ ok: false, error }`, never
 * a throw. A misconfigured driver used to poison the memoized promise, so
 * every subsequent send rejected and the rejection escaped into whatever was
 * calling — including the payment handler — see IDX-31. Clear the cache on
 * failure so the next call retries, and report the error in-band.
 */
export async function sendMail(
  input: SendMailInput,
): Promise<SendMailResult> {
  if (!driverPromise) driverPromise = selectDriver();
  try {
    const driver = await driverPromise;
    return await driver.send(input);
  } catch (err) {
    driverPromise = null;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mailer] send failed:", message);
    return { ok: false, error: message };
  }
}

export { selectDriver };
export { renderTemplate, renderString } from "./render";
