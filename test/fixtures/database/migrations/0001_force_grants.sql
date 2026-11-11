ALTER TABLE "kit"."note" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "kit"."note", "kit"."setting" TO "kit_app";
