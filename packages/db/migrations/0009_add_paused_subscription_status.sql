ALTER TYPE "public"."subscription_status" ADD VALUE 'paused' BEFORE 'past_due';
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "paused_at" timestamp with time zone;
