CREATE SCHEMA IF NOT EXISTS "kit";
--> statement-breakpoint
CREATE TABLE "kit"."note" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"body" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kit"."note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kit"."setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kit"."note" AS PERMISSIVE FOR ALL TO public USING ("kit"."note"."tenant" = current_setting('app.tenant', true)) WITH CHECK ("kit"."note"."tenant" = current_setting('app.tenant', true));