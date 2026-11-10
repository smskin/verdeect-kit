// AC-1.7 (UC-3), AC-3.13: KitConfigModule разбирает окружение при каждой сборке контекста Nest (prd.md §3.1 v1.13);
// окружение из bootstrapService (setPreparsedEnv) не разбирается повторно. Эталон — O app-config.module.ts.
import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    defineEnv,
    envBase,
    InvalidEnvironmentError,
    KitConfigModule,
} from '../../../src/config/index.js';
import { setPreparsedEnv } from '../../../src/internal/preparsed-env.js';

const schema = defineEnv({ ...envBase });

async function compile(): Promise<TestingModule> {
    return Test.createTestingModule({
        imports: [await KitConfigModule.forRoot({ schema })],
    }).compile();
}

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
    saved = { ...process.env };
});

afterEach(() => {
    for (const key of Object.keys(process.env)) {
        if (!(key in saved)) {
            delete process.env[key];
        }
    }
    Object.assign(process.env, saved);
    vi.unstubAllEnvs();
});

describe('UC-3: окружение в контексте Nest', () => {
    it('AC-1.7: два контекста с разным process.env получают разные значения', async () => {
        vi.stubEnv('PORT', '3001');
        const first = await compile();
        expect(first.get(ConfigService).get('PORT')).toBe(3001);

        vi.stubEnv('PORT', '3002');
        const second = await compile();
        expect(second.get(ConfigService).get('PORT')).toBe(3002);

        await first.close();
        await second.close();
    });

    it('AC-1.7: неверное окружение → сборка контекста отклоняется InvalidEnvironmentError с путём METRICS_PORT, forRoot сам не отклоняется', async () => {
        vi.stubEnv('PORT', '3005');
        vi.stubEnv('METRICS_PORT', '3005');

        const module = await KitConfigModule.forRoot({ schema });
        const error: unknown = await Test.createTestingModule({ imports: [module] })
            .compile()
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(InvalidEnvironmentError);
        expect((error as InvalidEnvironmentError).keys).toEqual(['METRICS_PORT']);
    });

    it('§3.1: ConfigService отдаёт разобранные типы', async () => {
        delete process.env.SHUTDOWN_TIMEOUT_MS;
        const context = await compile();

        expect(context.get(ConfigService).get('SHUTDOWN_TIMEOUT_MS')).toBe(10_000);

        await context.close();
    });

    it('AC-1.7: process.env после сборки не изменён', async () => {
        for (const key of [
            'METRICS_PORT',
            'REPLICA_ID',
            'SHUTDOWN_TIMEOUT_MS',
            'SHUTDOWN_DRAIN_MS',
        ]) {
            delete process.env[key];
        }
        const before = { ...process.env };
        const context = await compile();

        expect({ ...process.env }).toEqual(before);
        expect(context.get(ConfigService).get('METRICS_PORT')).toBe(9100);

        await context.close();
    });

    it('§3.1: разобранное окружение setPreparsedEnv отдаётся контексту без parseEnv', async () => {
        vi.stubEnv('PORT', 'не-порт');
        setPreparsedEnv(schema, { PORT: 4100 });
        const context = await compile();

        expect(context.get(ConfigService).get('PORT')).toBe(4100);

        await context.close();
    });

    it('§3.1: вторая сборка после подстановки разбирает process.env', async () => {
        vi.stubEnv('PORT', '4200');
        setPreparsedEnv(schema, { PORT: 4100 });
        const first = await compile();
        const second = await compile();

        expect(first.get(ConfigService).get('PORT')).toBe(4100);
        expect(second.get(ConfigService).get('PORT')).toBe(4200);

        await first.close();
        await second.close();
    });

    it('§3.1: фабрика провайдера другого глобального модуля видит разобранное окружение', async () => {
        vi.stubEnv('PORT', '4300');
        const PORT_COPY = Symbol('PORT_COPY');

        @Global()
        @Module({
            providers: [
                {
                    provide: PORT_COPY,
                    useFactory: (config: ConfigService) => config.get<number>('PORT'),
                    inject: [ConfigService],
                },
            ],
            exports: [PORT_COPY],
        })
        class ReaderModule {}

        const context = await Test.createTestingModule({
            imports: [ReaderModule, await KitConfigModule.forRoot({ schema })],
        }).compile();

        expect(context.get(PORT_COPY)).toBe(4300);

        await context.close();
    });
});
