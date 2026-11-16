// AC-4.20 (UC-3): запуск при недоступной БД (prd.md §3.2 стр. 85, §3.3 стр. 93 v1.31): KitDatabaseModule проверяет
// соединение (select 1 основного пула в сроке DB_POOL_ACQUIRE_TIMEOUT_MS) до прослушивания порта — одинаково с
// KitIdempotencyModule и без; failStartup → fatal DATABASE_UNAVAILABLE, одно событие GlitchTip с тегом code, без SQL и
// адреса БД. Проект isolated: vi.stubEnv, подмена process.exit, initFakeSentry. Срок — проверяемый (реальное ожидание).
import { createServer } from 'node:net';
import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { createTestSigner } from '@verdeect/auth/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KitConfigModule } from '../../../src/config/kit-config.module.js';
import { KitDatabaseModule } from '../../../src/database/kit-database.module.js';
import { bootstrapService } from '../../../src/http/bootstrap-service.js';
import { tcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { appUrl } from '../../support/database.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import { expectExit, useBootstrapStand } from '../../unit/http/bootstrap-support.js';
import { standEnv, standModule } from '../idempotency/support.js';

const ACQUIRE_TIMEOUT_MS = 1000 * TEST_TIMEOUT_SCALE;

@Injectable()
class ProbeLogger implements OnModuleInit {
    onModuleInit(): void {
        new Logger('probe').warn('probe: nest logger');
    }
}

@Module({
    imports: [
        KitConfigModule.forRoot({ schema: standEnv }),
        KitDatabaseModule.forRoot({ schema: fixtureSchema }),
    ],
    providers: [ProbeLogger],
})
class DatabaseOnlyModule {}

/** Адрес БД с другим хостом и портом. */
function withHostPort(url: string, host: string, port: number): string {
    const parsed = new URL(url);
    parsed.hostname = host;
    parsed.port = String(port);

    return parsed.toString();
}

/** Свободный порт: сервер слушает и сразу закрывается — соединения получают ECONNREFUSED. */
async function closedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (address === null || typeof address === 'string') {
        throw new Error('нет адреса');
    }

    return address.port;
}

describe('UC-3: запуск при недоступной БД', () => {
    const stand = useBootstrapStand({ DB_POOL_ACQUIRE_TIMEOUT_MS: String(ACQUIRE_TIMEOUT_MS) });
    let delivered: DeliveredEvent[];
    let stderr: string[];

    beforeAll(() => {
        delivered = initFakeSentry().delivered;
    });

    afterAll(async () => {
        await Sentry.close(1000);
    });

    beforeEach(() => {
        delivered.splice(0);
        stderr = [];
        const write = process.stderr.write.bind(process.stderr);
        vi.spyOn(process.stderr, 'write').mockImplementation(
            (chunk: string | Uint8Array, ...rest: unknown[]) => {
                stderr.push(
                    typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
                );

                return write(chunk, ...(rest as []));
            },
        );
    });

    /** Отказ запуска: exit 1, fatal DATABASE_UNAVAILABLE, одно событие с тегом, без SQL и адреса в логах и stderr. */
    async function expectDatabaseUnavailable(run: Promise<unknown>, host: string, port: number) {
        const exit = await expectExit(run);
        await Sentry.flush(1000);
        const records = stand.records();
        const output = [stand.text(), stderr.join(''), ...delivered.map((item) => item.body)];

        expect(exit.code).toBe(1);
        expect(records.some((record) => /слушает|listening/i.test(String(record.msg)))).toBe(false);
        expect(records.filter((record) => record.level === 60)).toEqual([
            expect.objectContaining({ code: 'DATABASE_UNAVAILABLE' }),
        ]);
        expect(delivered).toHaveLength(1);
        expect(delivered[0]?.tags).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
        for (const text of output) {
            expect(text).not.toContain('select');
            expect(text).not.toContain('to_regprocedure');
            expect(text).not.toContain(`${host}:${String(port)}`);
            expect(text).not.toContain('ExceptionHandler');
        }
    }

    it('AC-4.20: bootstrapService с KitDatabaseModule при БД за tcpProxy без ответа — порт не открыт, выход 1, fatal DATABASE_UNAVAILABLE, одно событие с тегом code, без select, to_regprocedure и адреса БД', async () => {
        const proxy = await tcpProxy(appUrl());
        const signer = await createTestSigner();
        try {
            proxy.blackhole();
            vi.stubEnv('DATABASE_URL', proxy.url);
            const { hostname, port } = new URL(proxy.url);
            const startedAt = performance.now();

            await expectDatabaseUnavailable(
                bootstrapService({ module: standModule(signer), service: 'kit', env: standEnv }),
                hostname,
                Number(port),
            );
            expect(performance.now() - startedAt).toBeGreaterThanOrEqual(ACQUIRE_TIMEOUT_MS - 50);
        } finally {
            await signer.close();
            await proxy.close();
        }
    });

    it('AC-4.20: то же без KitIdempotencyModule — закрытый порт', async () => {
        const port = await closedPort();
        vi.stubEnv('DATABASE_URL', withHostPort(appUrl(), '127.0.0.1', port));

        await expectDatabaseUnavailable(
            bootstrapService({ module: DatabaseOnlyModule, service: 'kit', env: standEnv }),
            '127.0.0.1',
            port,
        );
    });

    it('AC-4.20: без KitIdempotencyModule — tcpProxy без ответа', async () => {
        const proxy = await tcpProxy(appUrl());
        try {
            proxy.blackhole();
            vi.stubEnv('DATABASE_URL', proxy.url);
            const { hostname, port } = new URL(proxy.url);

            await expectDatabaseUnavailable(
                bootstrapService({ module: DatabaseOnlyModule, service: 'kit', env: standEnv }),
                hostname,
                Number(port),
            );
        } finally {
            await proxy.close();
        }
    });

    it('AC-4.20: bootstrapService с рабочей БД — сервис слушает, запись Nest Logger модуля сервиса есть в логах', async () => {
        vi.stubEnv('DATABASE_URL', appUrl());
        const app = stand.track(
            await bootstrapService({ module: DatabaseOnlyModule, service: 'kit', env: standEnv }),
        );

        expect(app.getHttpServer().listening).toBe(true);
        expect(stand.records()).toContainEqual(
            expect.objectContaining({ level: 40, msg: 'probe: nest logger' }),
        );
        expect(delivered).toHaveLength(0);
    });
});
