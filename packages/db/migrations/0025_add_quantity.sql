ALTER TABLE "products" ADD COLUMN "allow_quantity" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "min_quantity" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "max_quantity" integer;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "quantity" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "quantity" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "quantity" integer NOT NULL DEFAULT 1;
