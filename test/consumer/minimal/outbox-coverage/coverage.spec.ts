// AC-5.13 (UC-14): покрытие outbox — CompanyCreated покрыт успешным expectOutbox, упавший expectOutbox(CompanyArchived)
// покрытия не даёт (prd.md §3.8; GAP-2). Строка — SQL под ролью приложения в транзакции Db: expectOutbox проверяет
// строку, а не путь записи; брокера в этом прогоне нет. v1.26: use-case со своей транзакцией — expectOutbox({app, traceId})
// после COMMIT тоже засчитывается.
import 'reflect-metadata';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { KitConfigModule, defineEnv, envBase, envDatabase } from '@verdeect/kit/config';
import { KitCoreModule } from '@verdeect/kit/observability';
import { Db, KitDatabaseModule, newId } from '@verdeect/kit/database';
import { expectOutbox } from '@verdeect/kit/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { CompanyArchived, CompanyCreated } from '../src/service/events.js';
import * as schema from '../src/service/schema.js';

const envSchema = defineEnv({ ...envBase, ...envDatabase });
const acme = { tenant: 'acme', traceId: 'trace-coverage', actor: { channel: 'system' } };

describe('UC-14: покрытие outbox потребителя', () => {
    let ctx: INestApplicationContext;

    beforeAll(async () => {
        vi.stubEnv('DATABASE_URL', inject('kitDatabaseUrl') ?? '');
        vi.stubEnv('LOG_LEVEL', 'silent');

        @Module({
            imports: [
                KitConfigModule.forRoot({ schema: envSchema }),
                // Контекст без HTTP — ядро пакета явно (v1.25, AC-2.15).
                KitCoreModule.forRoot({ service: 'consumer', entry: 'cli' }),
                KitDatabaseModule.forRoot({ schema }),
            ],
        })
        class CoverageModule {}

        ctx = await NestFactory.createApplicationContext(CoverageModule, { logger: false });
        await ctx.init();
    });

    afterAll(async () => {
        await ctx.close();
        vi.unstubAllEnvs();
    });

    it('AC-5.13: CompanyCreated покрыт', async () => {
        await ctx.get(Db).transaction(acme, async (tx) => {
            await tx.execute(sql`insert into consumer.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
                values (${newId('evt')}, 'acme', 'consumer.company.created', 1, 'cmp_c', '{}', 't',
                        '{"companyId":"cmp_c","name":"Covered"}')`);
            await expectOutbox(tx, CompanyCreated);
        });
    });

    it('AC-5.13: use-case со своей транзакцией засчитывается — expectOutbox({app, traceId}) после COMMIT', async () => {
        const traceId = newId('trc');
        await ctx.get(Db).transaction({ ...acme, traceId }, async (tx) => {
            await tx.execute(sql`insert into consumer.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
                values (${newId('evt')}, 'acme', 'consumer.company.created', 1, 'cmp_t', '{}', ${traceId},
                        '{"companyId":"cmp_t","name":"Own"}')`);
        });

        await expectOutbox({ app: ctx, traceId }, CompanyCreated, { subjectId: 'cmp_t' });
    });

    it('AC-5.13: упавший expectOutbox(CompanyArchived) покрытия не даёт', async () => {
        await ctx.get(Db).transaction(acme, async (tx) => {
            await expect(expectOutbox(tx, CompanyArchived)).rejects.toThrow();
        });
    });
});
