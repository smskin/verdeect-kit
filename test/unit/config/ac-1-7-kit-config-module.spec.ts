// AC-1.7 (UC-3): KitConfigModule перечитывает окружение при каждой сборке контекста Nest (prd.md §3.1 v1.7).
// Эталон — O app-config.module.ts. ConfigModule дописывает умолчания в process.env, поэтому окружение
// восстанавливается вручную после каждого теста.
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    defineEnv,
    envBase,
    InvalidEnvironmentError,
    KitConfigModule,
} from '../../../src/config/index.js';

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

    it('AC-1.7: неверное окружение → forRoot отклоняется InvalidEnvironmentError с путём METRICS_PORT', async () => {
        vi.stubEnv('PORT', '3005');
        vi.stubEnv('METRICS_PORT', '3005');

        const error: unknown = await KitConfigModule.forRoot({ schema }).catch(
            (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(InvalidEnvironmentError);
        expect((error as InvalidEnvironmentError).keys).toEqual(['METRICS_PORT']);
    });

    it('§3.1: ConfigService отдаёт разобранные типы', async () => {
        delete process.env.SHUTDOWN_TIMEOUT_MS;
        const context = await compile();

        expect(context.get(ConfigService).get('SHUTDOWN_TIMEOUT_MS')).toBe(10_000);

        await context.close();
    });

    it('§3.1: KitConfigModule дописывает умолчания разобранных ключей в process.env (поведение @nestjs/config)', async () => {
        delete process.env.METRICS_PORT;
        const context = await compile();

        expect(process.env.METRICS_PORT).toBe('9100');

        await context.close();
    });
});
