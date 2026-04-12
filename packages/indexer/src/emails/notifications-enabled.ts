import { eq } from "drizzle-orm";
import { createDb } from "@paylix/db/client";
import { merchantProfiles } from "@paylix/db/schema";
import { config } from "../config";

const db = createDb(config.databaseUrl);

/**
 * Returns whether the merchant has automatic email notifications enabled.
 * Defaults to `true` if no merchant_profiles row exists yet — matching the
 * column default so newly-created orgs don't accidentally go silent.
 */
export async function notificationsEnabled(
  organizationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: merchantProfiles.notificationsEnabled })
    .from(merchantProfiles)
    .where(eq(merchantProfiles.organizationId, organizationId))
    .limit(1);
  return row?.enabled ?? true;
}
