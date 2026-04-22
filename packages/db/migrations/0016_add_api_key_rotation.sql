ALTER TABLE "api_keys" ADD COLUMN "previous_key_hash" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "previous_key_prefix" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_previous_key_hash_idx" ON "api_keys" ("previous_key_hash");
