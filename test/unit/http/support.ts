// Стенд тестов /http (prd.md §3.5, §3.8; AC-3.1, AC-3.4, AC-3.5): пробный модуль сервиса с KitConfigModule, контроллер
// POST /probe (ZodValidationPipe), GET /boom (неожиданная ошибка), GET /slow (долгий ответ), провайдер с хуками Nest и
// участниками KitLifecycle (журнал вызовов). nestjs-pino держит один pino-http на процесс: файл теста — одна конфигурация
// логгера (LOG_LEVEL=silent).
import 'reflect-metadata';
import {
    Body,
    Controller,
    Get,
    HttpCode,
    Injectable,
    Module,
    Post,
    type BeforeApplicationShutdown,
    type OnApplicationShutdown,
    type OnModuleDestroy,
} from '@nestjs/common';
import { afterEach, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { defineEnv, envBase, KitConfigModule } from '../../../src/config/index.js';
import { ZodValidationPipe } from '../../../src/http/zod-validation.pipe.js';
import { HealthRegistry } from '../../../src/observability/health-registry.js';
import { KitLifecycle } from '../../../src/observability/lifecycle.js';

/** Схема окружения пробного сервиса. */
export const probeEnv = defineEnv({ ...envBase });

/** Тело POST /probe. */
export const ProbeBody = z.strictObject({ title: z.string().min(1), tags: z.array(z.string()) });

/** Журнал хуков Nest и участников остановки (в порядке вызова). */
export const journal: string[] = [];

/** Задержка ответа GET /slow, мс. */
export const SLOW_MS = 300;

@Controller()
export class ProbeController {
    @Post('probe')
    @HttpCode(200)
    probe(@Body(new ZodValidationPipe(ProbeBody)) body: z.output<typeof ProbeBody>): object {
        return body;
    }

    @Get('boom')
    boom(): never {
        throw new Error('MARK_SECRET select * from x');
    }

    @Get('slow')
    async slow(): Promise<{ ok: true }> {
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS));

        return { ok: true };
    }
}

/** Провайдер, который подменяют overrides. */
@Injectable()
export class Greeter {
    greet(): string {
        return 'настоящий';
    }
}

/** Внедряет KitLifecycle и HealthRegistry (экспорт ядра) и пишет журнал хуков. */
@Injectable()
export class LifecycleProbe
    implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown
{
    constructor(
        readonly lifecycle: KitLifecycle,
        readonly health: HealthRegistry,
    ) {
        lifecycle.register(
            {
                name: 'probe-2',
                stop: () => void journal.push(`step2:stopping=${String(health.isStopping)}`),
            },
            { step: 2 },
        );
        lifecycle.register(
            { name: 'probe-4', stop: () => void journal.push('step4') },
            { step: 4 },
        );
    }

    onModuleDestroy(): void {
        journal.push('onModuleDestroy');
    }

    beforeApplicationShutdown(): void {
        journal.push('beforeApplicationShutdown');
    }

    onApplicationShutdown(): void {
        journal.push('onApplicationShutdown');
    }
}

@Module({
    imports: [KitConfigModule.forRoot({ schema: probeEnv })],
    controllers: [ProbeController],
    providers: [Greeter, LifecycleProbe],
})
export class ProbeModule {}

/** Модуль без KitConfigModule (KT-15 п. 2). */
@Module({ controllers: [ProbeController] })
export class NoConfigModule {}

/** Окружение тестов: тихий лог, без паузы шага 1. */
export function useProbeEnv(): void {
    beforeEach(() => {
        vi.stubEnv('LOG_LEVEL', 'silent');
        vi.stubEnv('SHUTDOWN_DRAIN_MS', '0');
        journal.splice(0);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });
}
