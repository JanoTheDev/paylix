// Re-export the better-auth user table as "users" for backwards compatibility
import { user } from "./auth";

export const users = user;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
