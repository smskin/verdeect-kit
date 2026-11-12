// createTestApp (prd.md §3.8 — E3, UC-14; KT-15 п. 3): приложение сервиса в процессе для тестов — тот же createHttpApp
// (адаптер, хуки, фильтр, участники остановки), модуль — Test.createTestingModule, overrides подменяют провайдеры.
// Эталон — O test/support/app.ts (createTestingModule → overrideProvider → compile → createNestApplication(adapter) →
// init → ready). @nestjs/testing — опциональный peer: грузится при вызове, /testing импортируется и без него (NFR-3).
// v1.22: http — тот же объект опций, что bootstrapService({http}) (KitHttpOptions из /http, AC-3.14). v1.25: logger и
// redaction — типы bootstrapService; overrides — useValue | useClass | useFactory(+inject); extraProviders; env объектом —
// подмена провайдера разобранного окружения KitConfigModule (process.env не читается и не меняется).
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type * as NestTesting from '@nestjs/testing';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { parseEnv } from '../config/parse-env.js';
import { buildHttpApp, type KitHttpOptions } from '../http/create-http-app.js';
import { KIT_ENV_SCHEMA, KIT_PARSED_ENV } from '../internal/preparsed-env.js';
import type { KitCoreLoggerOptions } from '../observability/kit-core.module.js';
import type { KitRedaction } from '../observability/redaction.js';
import { loadPeer } from '../internal/peer.js';
import { assertServiceName } from '../internal/service-name.js';
import { KIT_LOGGER } from '../internal/tokens.js';

/** Модуль `extraProviders` теста (глобальный). */
class KitTestExtrasModule {}

/** Подмена провайдера модуля сервиса: значение, класс или фабрика (`inject` — токены её аргументов). */
export type KitTestOverride =
    | {
          /** Токен DI: класс, символ или строка. */
          readonly provide: unknown;
          /** Значение вместо провайдера. */
          readonly useValue: unknown;
      }
    | {
          readonly provide: unknown;
          /** Класс вместо провайдера. */
          readonly useClass: Type;
      }
    | {
          readonly provide: unknown;
          /** Фабрика вместо провайдера. */
          readonly useFactory: (...args: never[]) => unknown;
          /** Токены аргументов фабрики. */
          readonly inject?: readonly unknown[];
      };

/** Опции `createTestApp` (§3.8). */
export interface KitTestAppOptions {
    /** Корневой модуль сервиса (импортирует `KitConfigModule.forRoot`). */
    readonly module: Type | DynamicModule;
    /** Имя сервиса `^[a-z][a-z0-9-]{1,31}$` — как у `bootstrapService`. */
    readonly service: string;
    /** Подмены провайдеров. */
    readonly overrides?: readonly KitTestOverride[];
    /** Опции HTTP — тот же объект, что `bootstrapService({http})` в `main.ts` (§3.8, AC-3.14). */
    readonly http?: KitHttpOptions;
    /** Опции логгера по роли — тот же объект, что `bootstrapService({logger})` (AC-2.2). */
    readonly logger?: KitCoreLoggerOptions;
    /** Правила редактирования — тот же объект, что `bootstrapService({redaction})`. */
    readonly redaction?: KitRedaction;
    /** Провайдеры, добавляемые в тестовый модуль (доступны через `app.get`). */
    readonly extraProviders?: readonly Provider[];
    /**
     * Окружение объектом вместо `process.env`: разбирается схемой `KitConfigModule.forRoot({schema})` модуля сервиса;
     * `process.env` не читается и не меняется — приложения с разным `env` работают параллельно в одном процессе.
     */
    readonly env?: Readonly<Record<string, string | undefined>>;
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
        ...options.http,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
        ...(options.redaction === undefined ? {} : { redaction: options.redaction }),
        caller: 'createTestApp',
        compile: async (root, adapter) => {
            const extra = options.extraProviders ?? [];
            const builder = Test.createTestingModule({
                // Глобальный модуль: провайдеры теста видны модулям сервиса (подмена useFactory с inject их внедряет).
                imports: [
                    root,
                    {
                        module: KitTestExtrasModule,
                        global: true,
                        providers: [...extra],
                        exports: extra.map((provider) =>
                            typeof provider === 'function' ? provider : provider.provide,
                        ),
                    },
                ],
            });
            const { env } = options;
            if (env !== undefined) {
                builder.overrideProvider(KIT_PARSED_ENV).useFactory({
                    factory: (schema: z.ZodType<Record<string, unknown>>) => parseEnv(schema, env),
                    inject: [KIT_ENV_SCHEMA],
                });
            }
            for (const override of options.overrides ?? []) {
                // boundary: токен DI — класс, символ или строка; тип @nestjs/testing шире unknown не принимает.
                const overridden = builder.overrideProvider(override.provide as string);
                if ('useValue' in override) {
                    overridden.useValue(override.useValue);
                } else if ('useClass' in override) {
                    overridden.useClass(override.useClass);
                } else {
                    overridden.useFactory({
                        factory: override.useFactory as (...args: unknown[]) => unknown,
                        inject: [...(override.inject ?? [])] as string[],
                    });
                }
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
