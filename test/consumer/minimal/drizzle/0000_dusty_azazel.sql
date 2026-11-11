CREATE SCHEMA IF NOT EXISTS "consumer";
--> statement-breakpoint
CREATE TABLE "consumer"."company" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumer"."company" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consumer"."idempotency_key" (
	"tenant" text,
	"subject" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text DEFAULT 'in_progress' NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"response_location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_key_scope_key" UNIQUE NULLS NOT DISTINCT("tenant","subject","key"),
	CONSTRAINT "idempotency_key_state_check" CHECK ("consumer"."idempotency_key"."state" IN ('in_progress', 'done'))
);
--> statement-breakpoint
ALTER TABLE "consumer"."idempotency_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idempotency_key_created_idx" ON "consumer"."idempotency_key" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "consumer"."company" AS PERMISSIVE FOR ALL TO public USING ("consumer"."company"."tenant" = current_setting('app.tenant', true)) WITH CHECK ("consumer"."company"."tenant" = current_setting('app.tenant', true));--> statement-breakpoint
CREATE POLICY "idempotency_key_scope" ON "consumer"."idempotency_key" AS PERMISSIVE FOR ALL TO public USING ("consumer"."idempotency_key"."tenant" IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')) WITH CHECK ("consumer"."idempotency_key"."tenant" IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), ''));