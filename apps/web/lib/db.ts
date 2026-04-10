import { createDb } from "@paylix/db/client";

export const db = createDb(process.env.DATABASE_URL!);
