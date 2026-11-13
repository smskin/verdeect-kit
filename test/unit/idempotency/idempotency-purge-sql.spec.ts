// idempotencyPurgeSql (prd.md §3.3а v1.14, AC-4.14; KT-20 п. 1): текст функции очистки SECURITY DEFINER для миграции
// сервиса; все идентификаторы в двойных кавычках, имя схемы — формат имени сервиса. src/idempotency/table.ts.
import { readFileSync } from 'node:fs';
import { pgSchema } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { idempotencyPurgeSql } from '../../../src/idempotency/table.js';

const FIXTURE = new URL(
    '../../fixtures/database/migrations/0007_idempotency_purge_v125.sql',
    import.meta.url,
);

describe('UC-7: idempotencyPurgeSql', () => {
    const text = idempotencyPurgeSql(pgSchema('kit'));

    it('AC-4.14: функция "kit"."idempotency_purge"(batch integer) RETURNS integer, SECURITY DEFINER, SET search_path = "kit", pg_temp', () => {
        expect(text).toContain(
            'CREATE FUNCTION "kit"."idempotency_purge"(batch integer) RETURNS integer',
        );
        expect(text.startsWith('DROP FUNCTION IF EXISTS "kit"."idempotency_purge"(integer);')).toBe(
            true,
        );
        expect(text).toContain('SECURITY DEFINER SET search_path = "kit", pg_temp');
    });

    it('AC-4.14: владелец kit_directory, REVOKE ALL … FROM PUBLIC, GRANT EXECUTE … TO kit_app, удаление старше 24 ч', () => {
        expect(text).toContain(
            'ALTER FUNCTION "kit"."idempotency_purge"(integer) OWNER TO "kit_directory";',
        );
        expect(text).toContain(
            'REVOKE ALL ON FUNCTION "kit"."idempotency_purge"(integer) FROM PUBLIC;',
        );
        expect(text).toContain(
            'GRANT EXECUTE ON FUNCTION "kit"."idempotency_purge"(integer) TO "kit_app";',
        );
        expect(text).toContain("o.created_at < now() - interval '24 hours'");
        expect(text.split('\n--> statement-breakpoint\n')).toHaveLength(9);
    });

    it.each(['Kit', 'k', 'kit_app', 'kit;drop', 'kit"x', 'a'.repeat(33)])(
        'KT-20: имя схемы вне формата имени сервиса ^[a-z][a-z0-9-]{1,31}$ → TypeError («%s»)',
        (name) => {
            expect(() => idempotencyPurgeSql(pgSchema(name))).toThrow(TypeError);
        },
    );

    it('KT-20: idempotencyPurgeSql(pgSchema(\'bff-app\')) — "bff-app"."idempotency_purge", OWNER TO "bff-app_directory", GRANT EXECUTE … TO "bff-app_app", SET search_path = "bff-app", pg_temp; все идентификаторы в двойных кавычках', () => {
        const hyphen = idempotencyPurgeSql(pgSchema('bff-app'));

        expect(hyphen).toContain('"bff-app"."idempotency_purge"(batch integer)');
        expect(hyphen).toContain('OWNER TO "bff-app_directory"');
        expect(hyphen).toContain('TO "bff-app_app";');
        expect(hyphen).toContain('SET search_path = "bff-app", pg_temp');
        expect(hyphen).toContain('DELETE FROM "bff-app"."idempotency_key" i');
        expect(hyphen).not.toMatch(/[^"]bff-app[^"_]/);
    });

    it('AC-4.14 v1.25: права kit_directory — REVOKE SELECT на таблицу, затем SELECT (ctid, created_at) и DELETE', () => {
        const statements = text.split('\n--> statement-breakpoint\n');
        const revoke = statements.indexOf(
            'REVOKE SELECT ON "kit"."idempotency_key" FROM "kit_directory";',
        );
        const grant = statements.indexOf(
            'GRANT SELECT (ctid, created_at), DELETE ON "kit"."idempotency_key" TO "kit_directory";',
        );

        expect(revoke).toBeGreaterThan(0);
        expect(grant).toBe(revoke + 1);
        expect(text).not.toContain('GRANT SELECT, DELETE');
    });

    it('AC-4.14: 0007_idempotency_purge_v125.sql фикстуры (поверх 0003) содержит текст idempotencyPurgeSql(kit) без изменений', () => {
        expect(readFileSync(FIXTURE, 'utf8')).toContain(text);
    });
});
