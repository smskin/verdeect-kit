// createTestApp (prd.md §3.8 — E3, UC-14; KT-15 п. 3): приложение сервиса в процессе для тестов — тот же createHttpApp
// (адаптер, хуки, фильтр, участники остановки), модуль — Test.createTestingModule, overrides подменяют провайдеры.
// Эталон — O test/support/app.ts (createTestingModule → overrideProvider → compile → createNestApplication(adapter) →
// init → ready). @nestjs/testing — опциональный peer: грузится при вызове, /testing импортируется и без него (NFR-3).
import type { DynamicModule, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type * as NestTesting from '@nestjs/testing';
import type { Logger } from 'pino';
import { buildHttpApp } from '../http/create-http-app.js';
import { loadPeer } from '../internal/peer.js';
import { assertServiceName } from '../internal/service-name.js';
import { KIT_LOGGER } from '../internal/tokens.js';

/** Подмена провайдера модуля сервиса. */
export interface KitTestOverride {
    /** Токен DI: класс, символ или строка. */
    readonly provide: unknown;
    /** Значение вместо провайдера. */
    readonly useValue: unknown;
}

/** Опции `createTestApp` (§3.8). */
export interface KitTestAppOptions {
    /** Корневой модуль сервиса (импортирует `KitConfigModule.forRoot`). */
    readonly module: Type | DynamicModule;
    /** Имя сервиса `^[a-z][a-z0-9-]{1,31}$` — как у `bootstrapService`. */
    readonly service: string;
    /** Подмены провайдеров. */
    readonly overrides?: readonly KitTestOverride[];
    /** Лимит тела запроса, байт. */
    readonly bodyLimit?: number;
}

/**
 * Приложение сервиса для тестов (§3.8): тот же `createHttpApp`, запросы — `app.inject(...)` без порта. Окружение —
 * из `process.env` через `KitConfigModule`. Закрытие — `app.close()`: шаги остановки 1–5 без сторожа и `exit`.
 * Нужен `@nestjs/testing` в зависимостях сервиса.
 */
export async function createTestApp(options: KitTestAppOptions): Promise<NestFastifyApplication> {
    assertServiceName(options.service, 'createTestApp');
    const { Test } = await loadPeer<typeof NestTesting>('@nestjs/testing', 'testing');
    const app = await buildHttpApp({
        module: options.module,
        service: options.service,
        bodyLimit: options.bodyLimit,
        caller: 'createTestApp',
        compile: async (root, adapter) => {
            const builder = Test.createTestingModule({ imports: [root] });
            for (const override of options.overrides ?? []) {
                // boundary: токен DI — класс, символ или строка; тип @nestjs/testing шире unknown не принимает.
                builder.overrideProvider(override.provide as string).useValue(override.useValue);
            }
            const moduleRef = await builder.compile();

            return moduleRef.createNestApplication<NestFastifyApplication>(adapter, {
                bufferLogs: true,
            });
        },
    });
    app.get<Logger>(KIT_LOGGER).debug(
        { service: options.service, overrides: options.overrides?.length ?? 0 },
        'testing: приложение собрано',
    );

    return app;
}
