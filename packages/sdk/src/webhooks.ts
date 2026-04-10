import { createHmac, timingSafeEqual } from "crypto";
import type { WebhookVerifyParams } from "./types";

export const webhooks = {
  verify(params: WebhookVerifyParams): boolean {
    const { payload, signature, secret } = params;

    if (!signature.startsWith("sha256=")) return false;

    try {
      const expected = createHmac("sha256", secret)
        .update(typeof payload === "string" ? payload : payload.toString("utf-8"))
        .digest("hex");

      const provided = signature.slice(7);

      if (expected.length !== provided.length) return false;

      return timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(provided, "hex")
      );
    } catch {
      return false;
    }
  },
};
