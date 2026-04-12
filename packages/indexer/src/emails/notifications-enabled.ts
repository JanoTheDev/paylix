import { eq } from "drizzle-orm";
import { createDb } from "@paylix/db/client";
import {
  merchantProfiles,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationKind,
} from "@paylix/db/schema";
import { config } from "../config";

const db = createDb(config.databaseUrl);

/**
 * Returns whether a specific email notification kind is enabled for the
 * merchant. Both the master `notificationsEnabled` switch AND the per-kind
 * preference must be true. Defaults to `true` if no profile row exists yet,
 * matching the schema defaults so newly-created orgs don't accidentally go
 * silent.
 */
export async function isNotificationEnabled(
  organizationId: string,
  kind: NotificationKind,
): Promise<boolean> {
  const [row] = await db
    .select({
      enabled: merchantProfiles.notificationsEnabled,
      preferences: merchantProfiles.notificationPreferences,
    })
    .from(merchantProfiles)
    .where(eq(merchantProfiles.organizationId, organizationId))
    .limit(1);

  if (!row) return true;
  if (!row.enabled) return false;

  const prefs = row.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
  return prefs[kind] ?? true;
}
