// AC-1.2 (C): /messaging без pg — forRoot с subscriber {dedupe: 'none'} собирается; с outbox — отказ с текстом AC-1.2
// при сборке модуля, до прослушивания порта (prd.md §3.4).
import { pgSchema } from 'drizzle-orm/pg-core';
import { KitMessagingModule, createOutboxTable } from '@verdeect/kit/messaging';

const results = [];
try {
    await KitMessagingModule.forRoot({ service: 'peer-check', subscriber: { dedupe: 'none' } });
    results.push('dedupe-none:ok');
} catch (error) {
    results.push(`dedupe-none:${error?.message ?? error}`);
}
try {
    const table = createOutboxTable(pgSchema('peer-check'));
    await KitMessagingModule.forRoot({ service: 'peer-check', outbox: { table, events: [] } });
    results.push('outbox:ok');
} catch (error) {
    results.push(`outbox:${error?.message ?? error}`);
}
console.log(results.join('\n'));
