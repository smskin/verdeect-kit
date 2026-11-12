// AC-2.15 (UC-13, prd.md §3.2 v1.25): KitCoreModule — ядро пакета вне HTTP: контекст CLI получает KitLifecycle,
// HealthRegistry, KIT_METRICS и логгер (entry 'cli'); без KitConfigModule — ошибка; модуль пакета без ядра — ошибка при
// сборке контекста с текстом про KitCoreModule. Соединений нет: пул pg ленивый.
import 'reflect-metadata';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Registry } from '@prometheus-io/client';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineEnv, envBase, envDatabase, KitConfigModule } from '../../../src/config/index.js';
import { KitDatabaseModule } from '../../../src/database/index.js';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import {
    HealthRegistry,
    KIT_METRICS,
    KitCoreModule,
    KitLifecycle,
} from '../../../src/observability/index.js';

const env = defineEnv({ ...envBase, ...envDatabase });
const contexts: INestApplicationContext[] = [];

async function context(imports: unknown[]): Promise<INestApplicationContext> {
    @Module({ imports: imports as never[] })
    class CliModule {}
    const ctx = await NestFactory.createApplicationContext(CliModule, {
        logger: false,
        abortOnError: false,
    });
    contexts.push(ctx);

    return ctx;
}

beforeEach(() => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('DATABASE_URL', 'postgres://kit_app:x@127.0.0.1:1/kit');
});

afterEach(async () => {
    await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
    vi.unstubAllEnvs();
});

describe('UC-13: ядро пакета вне HTTP', () => {
    it("AC-2.15: KitCoreModule({entry: 'cli'}) — KitLifecycle, HealthRegistry, KIT_METRICS, логгер с entry cli", async () => {
        const ctx = await context([
            KitConfigModule.forRoot({ schema: env }),
            KitCoreModule.forRoot({ service: 'probe', entry: 'cli' }),
        ]);

        expect(ctx.get(KitLifecycle)).toBeInstanceOf(KitLifecycle);
        expect(ctx.get(HealthRegistry)).toBeInstanceOf(HealthRegistry);
        expect(ctx.get(KIT_METRICS)).toBeInstanceOf(Registry);
        expect(ctx.get<Logger>(KIT_LOGGER).bindings()).toMatchObject({
            service: 'probe',
            entry: 'cli',
        });
    });

    it('AC-2.15: KitCoreModule без KitConfigModule — ошибка при сборке', async () => {
        await expect(
            context([KitCoreModule.forRoot({ service: 'probe', entry: 'cli' })]),
        ).rejects.toThrow(/KitCoreModule: модуль сервиса не импортирует KitConfigModule/);
    });

    it('AC-2.15: модуль пакета без ядра — ошибка при сборке контекста с текстом про KitCoreModule', async () => {
        await expect(
            context([
                KitConfigModule.forRoot({ schema: env }),
                KitDatabaseModule.forRoot({ schema: {} }),
            ]),
        ).rejects.toThrow(
            /KitDatabaseModule: нет ядра пакета — подключите KitCoreModule\.forRoot или запускайте через bootstrapService\/createHttpApp/,
        );
    });

    it('AC-2.15: модуль пакета с ядром собирается — пробы database и database-read зарегистрированы', async () => {
        const ctx = await context([
            KitConfigModule.forRoot({ schema: env }),
            KitCoreModule.forRoot({ service: 'probe', entry: 'cli' }),
            KitDatabaseModule.forRoot({ schema: {} }),
        ]);
        await ctx.init();
        const checks = Object.keys((await ctx.get(HealthRegistry).evaluate()).checks);

        expect(checks).toEqual(expect.arrayContaining(['database', 'database-read']));
    });
});
