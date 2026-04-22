ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_scheduled_at" timestamp with time zone;
