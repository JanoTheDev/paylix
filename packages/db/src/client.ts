import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const cache = new Map<string, ReturnType<typeof drizzle<typeof schema>>>();

export function createDb(connectionString: string) {
  const cached = cache.get(connectionString);
  if (cached) return cached;
  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema });
  cache.set(connectionString, db);
  return db;
}

export type Database = ReturnType<typeof createDb>;
