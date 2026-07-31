#!/usr/bin/env node
/**
 * Baseline-stamp an existing `db:push`-built database so it can adopt the
 * migration chain.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Before the DB-01 repair, `drizzle-kit migrate` had never completed on any
 * database: the chain aborted at 0011 because no migration created the
 * `organization` table, and drizzle runs the whole chain in ONE transaction, so
 * everything rolled back. Every deployment that exists was therefore created
 * with `db:push`, and has no `drizzle.__drizzle_migrations` table at all.
 *
 * Running `db:migrate` against such a database does NOT work, even with the
 * chain repaired: migration 0000 has no `IF NOT EXISTS` guards, so it fails
 * immediately with `type "billing_interval" already exists` and rolls back. The
 * careful guards in 0007/0031/0032/0033 are never reached.
 *
 * The fix is to record migrations 0000-0031 as already applied — which they
 * effectively are, since `db:push` built the schema those migrations describe —
 * and then let `db:migrate` run only the genuinely new work, 0032 and 0033.
 *
 * ── WHY THE CUTOFF IS 0031 ─────────────────────────────────────────────────
 * 0032 and 0033 are fully guarded (`IF NOT EXISTS`, `pg_constraint` checks), so
 * they are safe to run against a push-built database and are the only
 * migrations carrying changes push has not already made (the new indexes,
 * the FK-behaviour changes, and the requested indexer columns).
 *
 * 0031 must NOT run here. It is guarded against re-renaming, but its backfill
 * inserts one `organization` row per `user`, keyed by the user id. On a
 * push-built database real organizations already exist with their own ids, so
 * that backfill would create a spurious duplicate organization for every user.
 * Stamping it skips it.
 *
 * ── USAGE ──────────────────────────────────────────────────────────────────
 *   # inspect what would happen — makes no changes
 *   pnpm --filter @paylix/db db:baseline -- --dry-run
 *
 *   # stamp, then apply the remaining migrations
 *   pnpm --filter @paylix/db db:baseline
 *   pnpm --filter @paylix/db db:migrate
 *
 * Reads DATABASE_URL from the environment (the pnpm script loads ../../.env).
 * On Windows use 127.0.0.1, not localhost — IPv6 resolution breaks Postgres auth.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, "..", "migrations");
const CUTOFF_TAG = "0031_rename_owner_to_organization";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const FORCE = argv.includes("--force");

function fail(msg) {
  console.error(`\n  ERROR  ${msg}\n`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set.");

const journal = JSON.parse(
  fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
);

// Same hash drizzle computes: sha256 over the raw file text, paired with the
// journal's `when` as created_at. See drizzle-orm/migrator.js readMigrationFiles.
const entries = journal.entries.map((e) => {
  const file = path.join(MIGRATIONS_DIR, `${e.tag}.sql`);
  if (!fs.existsSync(file)) fail(`Journal references ${e.tag}.sql, which is missing.`);
  return {
    tag: e.tag,
    when: e.when,
    hash: crypto.createHash("sha256").update(fs.readFileSync(file, "utf8")).digest("hex"),
  };
});

const cutoffIdx = entries.findIndex((e) => e.tag === CUTOFF_TAG);
if (cutoffIdx === -1) fail(`Cutoff migration ${CUTOFF_TAG} is not in the journal.`);

const toStamp = entries.slice(0, cutoffIdx + 1);
const toRun = entries.slice(cutoffIdx + 1);

// onnotice: silence the "relation already exists, skipping" NOTICEs that the
// IF NOT EXISTS statements below emit — postgres.js renders them as
// error-shaped objects, which reads alarmingly in an operational script.
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  // ── Guard 1: this must actually be a Paylix database ─────────────────────
  const [{ count: tableCount }] = await sql`
    SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('payments','subscriptions','checkout_sessions','organization')`;
  if (tableCount < 4) {
    fail(
      "This does not look like a push-built Paylix database (missing core tables).\n" +
        "         An EMPTY database needs no baseline — just run `db:migrate`.",
    );
  }

  // ── Guard 2: the org rename must already be done ─────────────────────────
  // If payments still has user_id, this database predates the rename and must
  // go through 0031 for real rather than being stamped past it.
  const [{ count: legacyCols }] = await sql`
    SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'user_id'`;
  if (legacyCols > 0) {
    fail(
      "payments.user_id still exists — this database predates the organization\n" +
        "         rename, so stamping past 0031 would skip work it genuinely needs.\n" +
        "         Restore into a scratch database and migrate there, or contact the maintainers.",
    );
  }

  // ── Guard 3: don't double-stamp ──────────────────────────────────────────
  await sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  await sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`;
  const existing = await sql`SELECT hash, created_at FROM "drizzle"."__drizzle_migrations"`;
  if (existing.length > 0 && !FORCE) {
    fail(
      `"drizzle"."__drizzle_migrations" already has ${existing.length} row(s), so this\n` +
        "         database is already migration-managed. Just run `db:migrate`.\n" +
        "         Pass --force only if you know the table is wrong.",
    );
  }

  console.log(`\n  Database : ${url.replace(/:[^:@/]*@/, ":****@")}`);
  console.log(`  Stamping : ${toStamp.length} migrations as already applied (through ${CUTOFF_TAG})`);
  console.log(`  Leaving  : ${toRun.length} to be applied by db:migrate`);
  for (const e of toRun) console.log(`             - ${e.tag}`);

  if (DRY_RUN) {
    console.log("\n  --dry-run: no changes written.\n");
  } else {
    await sql.begin(async (tx) => {
      for (const e of toStamp) {
        await tx`INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at")
                 VALUES (${e.hash}, ${e.when})`;
      }
    });
    console.log(`\n  Stamped ${toStamp.length} rows. Next: pnpm --filter @paylix/db db:migrate\n`);
  }
} finally {
  await sql.end();
}
