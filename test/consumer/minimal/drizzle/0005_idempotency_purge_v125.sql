DROP FUNCTION IF EXISTS "consumer"."idempotency_purge"(integer);
--> statement-breakpoint
CREATE FUNCTION "consumer"."idempotency_purge"(batch integer) RETURNS integer
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "consumer", pg_temp AS $$
DECLARE deleted integer;
BEGIN
    DELETE FROM "consumer"."idempotency_key" i WHERE i.ctid IN (
        SELECT o.ctid FROM "consumer"."idempotency_key" o
        WHERE o.created_at < now() - interval '24 hours' ORDER BY o.created_at LIMIT batch);
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END $$;
--> statement-breakpoint
REVOKE SELECT ON "consumer"."idempotency_key" FROM "consumer_directory";
--> statement-breakpoint
GRANT SELECT (ctid, created_at), DELETE ON "consumer"."idempotency_key" TO "consumer_directory";
--> statement-breakpoint
GRANT CREATE ON SCHEMA "consumer" TO "consumer_directory";
--> statement-breakpoint
ALTER FUNCTION "consumer"."idempotency_purge"(integer) OWNER TO "consumer_directory";
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "consumer" FROM "consumer_directory";
--> statement-breakpoint
REVOKE ALL ON FUNCTION "consumer"."idempotency_purge"(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "consumer"."idempotency_purge"(integer) TO "consumer_app";