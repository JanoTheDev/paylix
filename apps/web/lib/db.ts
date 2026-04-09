import { createDb } from "@paykit/db/client";

export const db = createDb(process.env.DATABASE_URL!);
