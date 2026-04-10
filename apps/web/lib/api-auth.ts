import { db } from "./db";
import { apiKeys, users } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { hashApiKey } from "./api-key-utils";

export async function authenticateApiKey(request: Request): Promise<{
  user: typeof users.$inferSelect;
  keyType: "publishable" | "secret";
} | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const key = authHeader.slice(7);
  const hash = hashApiKey(key);

  const [found] = await db
    .select({
      key: apiKeys,
      user: users,
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.isActive, true)));

  if (!found) return null;

  // Update lastUsedAt
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, found.key.id));

  return { user: found.user, keyType: found.key.type };
}
