CREATE TYPE "customer_notification_category" AS ENUM ('marketing', 'trial_reminders', 'abandonment', 'receipts');--> statement-breakpoint
CREATE TABLE "customer_notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "category" "customer_notification_category" NOT NULL,
  "opted_in" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notif_prefs_unique" ON "customer_notification_preferences" ("customer_id", "category");
