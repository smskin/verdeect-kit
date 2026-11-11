CREATE TABLE "kit"."idempotency_key" (
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
	CONSTRAINT "idempotency_key_state_check" CHECK ("kit"."idempotency_key"."state" IN ('in_progress', 'done'))
);
--> statement-breakpoint
ALTER TABLE "kit"."idempotency_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idempotency_key_created_idx" ON "kit"."idempotency_key" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "idempotency_key_scope" ON "kit"."idempotency_key" AS PERMISSIVE FOR ALL TO public USING ("kit"."idempotency_key"."tenant" IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')) WITH CHECK ("kit"."idempotency_key"."tenant" IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), ''));