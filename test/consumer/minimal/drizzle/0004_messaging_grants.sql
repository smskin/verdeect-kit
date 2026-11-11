ALTER TABLE "consumer"."outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "consumer"."outbox" TO "consumer_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "consumer"."inbox" TO "consumer_app";
