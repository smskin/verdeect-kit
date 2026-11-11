// AC-4.4 (UC-4, UC-8): обрыв соединения — сломанный клиент уничтожается, пул не исчерпан; пулы закрываются на шаге 4
// (prd.md §3.3). Перенос O connection-lost и ac-10-8-shutdown (случай 1): обрыв через tcpProxy.
import { Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEnv } from '../../../src/config/define-env.js';
import { envBase, envDatabase } from '../../../src/config/fragments.js';
import { KitConfigModule } from '../../../src/config/kit-config.module.js';
import { Db, mainPoolOf } from '../../../src/database/db.js';
import { DRIZZLE_READ, KitDatabaseModule } from '../../../src/database/kit-database.module.js';
import type { NodePgDatabase, Pool } from '../../../src/database/pg.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { appUrl, createDbApp, createTestDb, ctx, type TestDb } from '../../support/database.js';

const envSchema = defineEnv({ ...envBase, ...envDatabase });

@Module({
    imports: [
        KitConfigModule.forRoot({ schema: envSchema }),
        KitDatabaseModule.forRoot({ schema: fixtureSchema }),
    ],
})
class ShutdownModule {}

async function backendPid(test: TestDb): Promise<number | undefined> {
    return test.db.transaction(ctx('acme'), async (tx) => {
        const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);

        return rows[0]?.pid;
    });
}

describe('UC-4: обрыв соединения', () => {
    let proxy: TcpProxy;
    let test: TestDb;

    beforeAll(async () => {
        proxy = await tcpProxy(appUrl());
        test = await createTestDb({ poolMax: 2, url: proxy.url });
    });

    afterAll(async () => {
        await test.close();
        await proxy.close();
    });

    it('AC-4.4: 2 × DB_POOL_MAX обрывов до BEGIN — пул не исчерпан, следующая транзакция проходит', async () => {
        await backendPid(test);
        for (let attempt = 0; attempt < 4; attempt += 1) {
            await proxy.break();
            await test.db
                .transaction(ctx('acme'), (tx) => tx.execute(sql`select 1`))
                .catch(() => undefined);
            await proxy.restore();
        }

        expect(await backendPid(test)).toBeTypeOf('number');
        expect(test.main.totalCount).toBeLessThanOrEqual(2);
        expect(test.main.waitingCount).toBe(0);
    });

    it('AC-4.4: обрыв посреди транзакции через tcpProxy.break — отказ, процесс жив, после restore — новая транзакция на новом соединении', async () => {
        const before = await backendPid(test);
        await expect(
            test.db.transaction(ctx('acme'), async (tx) => {
                await tx.execute(sql`select 1`);
                await proxy.break();
                await tx.execute(sql`select 1`);
            }),
        ).rejects.toThrow();
        await proxy.restore();

        const after = await backendPid(test);
        expect(after).toBeTypeOf('number');
        expect(after).not.toBe(before);
    });

    it('UC-8: onApplicationShutdown закрывает оба пула (createDbApp + app.close(), затем pool.totalCount === 0)', async () => {
        const app = await createDbApp({
            module: ShutdownModule,
            schema: envSchema,
            env: { DATABASE_URL: appUrl(), LOG_LEVEL: 'silent' },
        });
        await app.init();
        const main = mainPoolOf(app.get(Db));
        const read = app.get<NodePgDatabase & { $client: Pool }>(DRIZZLE_READ).$client;
        await app.get(Db).transaction(ctx('acme'), (tx) => tx.execute(sql`select 1`));
        await app.get(Db).readGlobal((reader) => reader.execute(sql`select 1`));

        await app.close();

        expect(main.totalCount).toBe(0);
        expect(read.totalCount).toBe(0);
        expect(main.ended).toBe(true);
        expect(read.ended).toBe(true);
    });
});
