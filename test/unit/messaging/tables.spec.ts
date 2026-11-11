// §6, AC-5.15 (U): createOutboxTable (tenantNullable), createInboxTable — колонки, индексы, политика (prd.md §3.4, §6);
// src/messaging/tables.ts. Эталон — O outbox.schema.ts, inbox.schema.ts.
import { getTableConfig, pgSchema } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { OUTBOX_POLICY, OUTBOX_POLICY_SQL } from '../../../src/internal/outbox-policy.js';
import {
    createInboxTable,
    createOutboxTable,
    outboxTenantNullable,
} from '../../../src/messaging/tables.js';

const kit = pgSchema('kit');

describe('UC-5: таблицы сообщений', () => {
    it('§6: createOutboxTable — колонки и индексы (getTableConfig)', () => {
        const config = getTableConfig(createOutboxTable(kit));

        expect(config.name).toBe('outbox');
        expect(config.schema).toBe('kit');
        expect(config.columns.map((column) => column.name).sort()).toEqual(
            [
                'id',
                'seq',
                'tenant',
                'type',
                'version',
                'subject_id',
                'actor',
                'trace_id',
                'data',
                'occurred_at',
                'published_at',
                'attempts',
                'last_error',
            ].sort(),
        );
        expect(config.indexes.map((item) => item.config.name).sort()).toEqual([
            'outbox_published_at_idx',
            'outbox_unpublished_seq_idx',
        ]);
        expect(config.primaryKeys).toHaveLength(0);
        expect(config.columns.find((column) => column.name === 'id')?.primary).toBe(true);
    });

    it('§6: tenantNullable: false → tenant notNull; true → nullable (outboxTenantNullable)', () => {
        const strict = createOutboxTable(kit);
        const nullable = createOutboxTable(kit, { tenantNullable: true });

        expect(outboxTenantNullable(strict)).toBe(false);
        expect(outboxTenantNullable(nullable)).toBe(true);
    });

    it('§6: политика outbox_tenant_isolation с OUTBOX_POLICY_SQL', () => {
        const [policy] = getTableConfig(createOutboxTable(kit)).policies;

        expect(policy?.name).toBe(OUTBOX_POLICY);
        expect(policy?.for).toBe('all');
        expect(JSON.stringify(policy?.using)).toContain(OUTBOX_POLICY_SQL);
    });

    it('§6: createInboxTable — id PK, без политики', () => {
        const config = getTableConfig(createInboxTable(kit));

        expect(config.name).toBe('inbox');
        expect(config.columns.find((column) => column.name === 'id')?.primary).toBe(true);
        expect(config.columns.map((column) => column.name).sort()).toEqual([
            'id',
            'received_at',
            'type',
        ]);
        expect(config.policies).toHaveLength(0);
        expect(config.indexes.map((item) => item.config.name)).toEqual(['inbox_received_at_idx']);
    });

    it('§3.4: схема вне ^[a-z][a-z0-9-]{1,31}$ → TypeError', () => {
        expect(() => createOutboxTable(pgSchema('Kit_App'))).toThrow(TypeError);
        expect(() => createInboxTable(pgSchema('Kit_App'))).toThrow(TypeError);
    });
});
