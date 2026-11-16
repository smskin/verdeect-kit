// AC-2.15 (UC-13, prd.md §3.2 v1.25, §3.3 v1.31): контекст CLI — NestFactory.createApplicationContext с ядром
// KitCoreModule({entry: 'cli'}) и KitDatabaseModule на БД стенда startTestStack (logger: false, abortOnError: false):
// сборка проходит проверку соединения, пробы database и database-read зарегистрированы. Окружение — setPreparsedEnv
// (механизм bootstrapService), без vi.stubEnv: файл в проекте shared.
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { defineEnv, envBase, envDatabase, KitConfigModule } from '../../../src/config/index.js';
import { parseEnv } from '../../../src/config/parse-env.js';
import { KitDatabaseModule } from '../../../src/database/index.js';
import { setPreparsedEnv } from '../../../src/internal/preparsed-env.js';
import { HealthRegistry, KitCoreModule } from '../../../src/observability/index.js';
import { appUrl } from '../../support/database.js';

const env = defineEnv({ ...envBase, ...envDatabase });

describe('UC-13: ядро пакета вне HTTP на БД стенда', () => {
    it('AC-2.15: модуль пакета с ядром собирается — пробы database и database-read зарегистрированы', async () => {
        setPreparsedEnv(env, parseEnv(env, { DATABASE_URL: appUrl(), LOG_LEVEL: 'silent' }));

        @Module({
            imports: [
                KitConfigModule.forRoot({ schema: env }),
                KitCoreModule.forRoot({ service: 'probe', entry: 'cli' }),
                KitDatabaseModule.forRoot({ schema: {} }),
            ],
        })
        class CliModule {}

        const ctx = await NestFactory.createApplicationContext(CliModule, {
            logger: false,
            abortOnError: false,
        });
        try {
            await ctx.init();
            const { checks } = await ctx.get(HealthRegistry).evaluate();

            expect(checks).toMatchObject({ database: 'up', 'database-read': 'up' });
        } finally {
            await ctx.close();
        }
    });
});
