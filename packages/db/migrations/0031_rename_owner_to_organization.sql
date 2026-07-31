-- Rename the per-merchant owner column from `user_id` / `merchant_id` to
-- `organization_id`, and repoint its foreign key from `user` to
-- `organization`.
--
-- WHY THIS EXISTS (audit DB-01, Critical):
-- Migrations 0000-0003 created `user_id` on products, customers, payments,
-- subscriptions, api_keys, webhooks, checkout_sessions and
-- merchant_payout_wallets, `user_id` as the PK of merchant_profiles, and
-- `merchant_id` on invoices. The application schema
-- (packages/db/src/schema/**) declares `organization_id` on all ten. No
-- migration ever performed the rename, so `db:migrate` produced a database
-- every application query failed against.
--
-- This is a RENAME, never a drop-and-add: `ALTER TABLE ... RENAME COLUMN`
-- preserves the data. Drizzle cannot infer a rename non-interactively and
-- would emit `DROP COLUMN user_id` + `ADD COLUMN organization_id`, silently
-- destroying every ownership link — hence the hand-written statements.
--
-- DATA MODEL NOTE:
-- The column's values are user ids, but the new FK targets `organization`.
-- Rather than rewriting every row, this migration creates one organization
-- per owning user REUSING THE USER ID AS THE ORGANIZATION ID, so every
-- existing value stays valid and no data is rewritten. A matching `member`
-- row makes the user the owner of that organization. On a fresh database
-- there are no users, so the backfill is a no-op.
--
-- Every statement is guarded on information_schema / pg_constraint so the
-- migration is safe to re-run and safe against a database that was stood up
-- with `db:push` (already renamed).

-- 1. One organization per user that owns data, id := user.id.
--
-- `organization` has TWO unique constraints: the primary key on id and
-- `organization_slug_unique` on slug. An `ON CONFLICT ("id")` target only
-- covers the first, so a user whose id collides with an existing org's SLUG
-- would raise `duplicate key value violates unique constraint
-- "organization_slug_unique"` and — because drizzle runs the whole chain in one
-- transaction — abort every migration.
--
-- Simply skipping such a user is NOT safe either: step 3 adds a foreign key
-- from every renamed organization_id to organization(id), so a user left
-- without an organization row would fail that FK instead. So when the natural
-- slug is taken, derive a unique one rather than skipping the row. The
-- derived slug is deterministic per user id and therefore unique among the
-- rows this statement inserts. The untargeted `ON CONFLICT DO NOTHING` is a
-- final backstop that covers a conflict on ANY constraint.
INSERT INTO "organization" ("id", "name", "slug", "created_at")
SELECT u."id",
       COALESCE(NULLIF(u."name", ''), u."email"),
       CASE
         WHEN EXISTS (SELECT 1 FROM "organization" s WHERE s."slug" = u."id")
           THEN u."id" || '-' || substr(md5(u."id"), 1, 8)
         ELSE u."id"
       END,
       COALESCE(u."created_at", now())
FROM "user" u
WHERE NOT EXISTS (
	SELECT 1 FROM "organization" o WHERE o."id" = u."id"
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2. Make each user the owner of their organization.
INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
SELECT 'mbr_' || u."id", u."id", u."id", 'owner', COALESCE(u."created_at", now())
FROM "user" u
WHERE NOT EXISTS (
	SELECT 1 FROM "member" m WHERE m."organization_id" = u."id" AND m."user_id" = u."id"
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- 3. Rename the columns and repoint the foreign keys.
DO $$
DECLARE
	t text;
	old_col text;
	tables text[] := ARRAY[
		'products', 'customers', 'payments', 'subscriptions', 'api_keys',
		'webhooks', 'checkout_sessions', 'merchant_payout_wallets',
		'merchant_profiles', 'invoices'
	];
BEGIN
	FOREACH t IN ARRAY tables LOOP
		-- invoices used `merchant_id`; every other table used `user_id`.
		old_col := CASE WHEN t = 'invoices' THEN 'merchant_id' ELSE 'user_id' END;

		-- Rename only if the old column is still there and the new one is not.
		IF EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = t AND column_name = old_col
		) AND NOT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
		) THEN
			EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', t, old_col, 'organization_id');
		END IF;

		-- Drop the old FK to "user" (named after the pre-rename column).
		EXECUTE format(
			'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
			t, t || '_' || old_col || '_user_id_fk'
		);

		-- Add the FK to "organization" using drizzle's naming convention.
		IF NOT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conname = t || '_organization_id_organization_id_fk'
		) THEN
			EXECUTE format(
				'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action',
				t, t || '_organization_id_organization_id_fk'
			);
		END IF;
	END LOOP;
END $$;
--> statement-breakpoint

-- 4. Rename the indexes and constraints that carried the old column name.
--    ALTER INDEX / ALTER TABLE RENAME CONSTRAINT have no IF EXISTS form for
--    the source name, so each is guarded.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'customers_user_customer_idx' AND relkind = 'i') THEN
		ALTER INDEX "customers_user_customer_idx" RENAME TO "customers_org_customer_idx";
	END IF;
	IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'merchant_profiles_user_idx' AND relkind = 'i') THEN
		DROP INDEX "merchant_profiles_user_idx";
	END IF;
	IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'invoices_merchant_number_idx' AND relkind = 'i') THEN
		ALTER INDEX "invoices_merchant_number_idx" RENAME TO "invoices_org_number_idx";
	END IF;
	IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'invoices_merchant_issued_idx' AND relkind = 'i') THEN
		ALTER INDEX "invoices_merchant_issued_idx" RENAME TO "invoices_org_issued_idx";
	END IF;
END $$;
