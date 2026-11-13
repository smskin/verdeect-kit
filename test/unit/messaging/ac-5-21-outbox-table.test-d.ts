// AC-5.21 (U; prd.md §3.4 v1.26): тип колонки tenant таблицы createOutboxTable — по tenantNullable: string у таблицы по
// умолчанию и с tenantNullable: false, string | null с tenantNullable: true; обе формы — KitOutboxTable и outbox.table.
import { pgSchema } from 'drizzle-orm/pg-core';
import { describe, expectTypeOf, it } from 'vitest';
import type { KitMessagingModuleOptions } from '../../../src/messaging/kit-messaging.module.js';
import { createOutboxTable, type KitOutboxTable } from '../../../src/messaging/tables.js';

const schema = pgSchema('svc-a');
const byDefault = createOutboxTable(schema);
const notNullable = createOutboxTable(schema, { tenantNullable: false });
const nullable = createOutboxTable(schema, { tenantNullable: true });

type OutboxOption = NonNullable<KitMessagingModuleOptions['outbox']>['table'];

describe('UC-5: тип tenant таблицы outbox', () => {
    it('AC-5.21: без опций и с tenantNullable: false — tenant: string', () => {
        expectTypeOf<(typeof byDefault.$inferSelect)['tenant']>().toEqualTypeOf<string>();
        expectTypeOf<(typeof notNullable.$inferSelect)['tenant']>().toEqualTypeOf<string>();
    });

    it('AC-5.21: tenantNullable: true — tenant: string | null', () => {
        expectTypeOf<(typeof nullable.$inferSelect)['tenant']>().toEqualTypeOf<string | null>();
    });

    it('AC-5.21: обе формы — KitOutboxTable и поле outbox.table модуля', () => {
        expectTypeOf(byDefault).toExtend<KitOutboxTable>();
        expectTypeOf(notNullable).toExtend<KitOutboxTable>();
        expectTypeOf(nullable).toExtend<KitOutboxTable>();
        expectTypeOf(byDefault).toExtend<OutboxOption>();
        expectTypeOf(nullable).toExtend<OutboxOption>();
    });
});
