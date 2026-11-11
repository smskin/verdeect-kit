ALTER TABLE "kit"."outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "kit"."outbox" TO "kit_app";
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "kit"."inbox" TO "kit_app";
