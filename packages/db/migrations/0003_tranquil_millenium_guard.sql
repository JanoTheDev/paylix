CREATE TYPE "public"."invoice_email_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "merchant_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"address_line_1" text DEFAULT '' NOT NULL,
	"address_line_2" text,
	"city" text DEFAULT '' NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"tax_id" text,
	"support_email" text DEFAULT '' NOT NULL,
	"logo_url" text,
	"invoice_prefix" text DEFAULT 'INV-' NOT NULL,
	"invoice_footer" text,
	"invoice_sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"hosted_token" text NOT NULL,
	"number" text NOT NULL,
	"merchant_legal_name" text DEFAULT '' NOT NULL,
	"merchant_address_line_1" text DEFAULT '' NOT NULL,
	"merchant_address_line_2" text,
	"merchant_city" text DEFAULT '' NOT NULL,
	"merchant_postal_code" text DEFAULT '' NOT NULL,
	"merchant_country" text DEFAULT '' NOT NULL,
	"merchant_tax_id" text,
	"merchant_support_email" text DEFAULT '' NOT NULL,
	"merchant_logo_url" text,
	"merchant_footer" text,
	"customer_name" text,
	"customer_email" text,
	"customer_country" text,
	"customer_tax_id" text,
	"customer_address" text,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"tax_label" text,
	"tax_rate_bps" integer,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_status" "invoice_email_status" DEFAULT 'pending' NOT NULL,
	"email_sent_at" timestamp with time zone,
	"email_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_label" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reverse_charge_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "collect_country" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "collect_tax_id" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_merchant_id_user_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_profiles_user_idx" ON "merchant_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_payment_idx" ON "invoices" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_hosted_token_idx" ON "invoices" USING btree ("hosted_token");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_merchant_number_idx" ON "invoices" USING btree ("merchant_id","number");--> statement-breakpoint
CREATE INDEX "invoices_merchant_issued_idx" ON "invoices" USING btree ("merchant_id","issued_at");--> statement-breakpoint
CREATE INDEX "invoices_customer_issued_idx" ON "invoices" USING btree ("customer_id","issued_at");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id");