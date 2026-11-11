CREATE TABLE "kit"."inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kit"."outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "kit"."outbox_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant" text,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"subject_id" text NOT NULL,
	"actor" jsonb NOT NULL,
	"trace_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "kit"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "inbox_received_at_idx" ON "kit"."inbox" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_seq_idx" ON "kit"."outbox" USING btree ("seq") WHERE "kit"."outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_published_at_idx" ON "kit"."outbox" USING btree ("published_at") WHERE "kit"."outbox"."published_at" is not null;--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "kit"."outbox" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.tenant', true), '') = '' OR tenant = current_setting('app.tenant', true)) WITH CHECK (coalesce(current_setting('app.tenant', true), '') = '' OR tenant = current_setting('app.tenant', true));