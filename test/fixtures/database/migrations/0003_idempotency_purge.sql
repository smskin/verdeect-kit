ALTER TABLE "kit"."idempotency_key" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "kit"."idempotency_key" TO "kit_app";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "kit"."idempotency_purge"(batch integer) RETURNS integer
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "kit", pg_temp AS $$
DECLARE deleted integer;
BEGIN
    DELETE FROM "kit"."idempotency_key" i WHERE i.ctid IN (
        SELECT o.ctid FROM "kit"."idempotency_key" o
        WHERE o.created_at < now() - interval '24 hours' ORDER BY o.created_at LIMIT batch);
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END $$;
--> statement-breakpoint
GRANT SELECT, DELETE ON "kit"."idempotency_key" TO "kit_directory";
--> statement-breakpoint
GRANT CREATE ON SCHEMA "kit" TO "kit_directory";
--> statement-breakpoint
ALTER FUNCTION "kit"."idempotency_purge"(integer) OWNER TO "kit_directory";
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "kit" FROM "kit_directory";
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kit"."idempotency_purge"(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kit"."idempotency_purge"(integer) TO "kit_app";
