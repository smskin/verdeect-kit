CREATE TABLE "consumer"."inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer"."outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "consumer"."outbox_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant" text NOT NULL,
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
ALTER TABLE "consumer"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "inbox_received_at_idx" ON "consumer"."inbox" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_seq_idx" ON "consumer"."outbox" USING btree ("seq") WHERE "consumer"."outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_published_at_idx" ON "consumer"."outbox" USING btree ("published_at") WHERE "consumer"."outbox"."published_at" is not null;--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "consumer"."outbox" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.tenant', true), '') = '' OR tenant = current_setting('app.tenant', true)) WITH CHECK (coalesce(current_setting('app.tenant', true), '') = '' OR tenant = current_setting('app.tenant', true));