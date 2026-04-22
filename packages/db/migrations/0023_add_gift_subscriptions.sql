ALTER TABLE "subscriptions" ADD COLUMN "is_gift" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "gift_expires_at" timestamp with time zone;
