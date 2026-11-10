// §3.5, §3.2 шаги 1–5, §3.8 (UC-8, UC-14; KT-11, KT-15 п. 1–3): createHttpApp и createTestApp — app.close() = lifecycle.close(),
// шаг 2 http до шага 3 nest, хуки Nest в своём порядке, keep-alive не держит остановку, экспорт ядра, overrides,
// обязательный KitConfigModule, формат имени сервиса.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpApp } from '../../../src/http/index.js';
import { HealthRegistry } from '../../../src/observability/health-registry.js';
import { createTestApp } from '../../../src/testing/index.js';
import {
    Greeter,
    journal,
    LifecycleProbe,
    NoConfigModule,
    ProbeModule,
    SLOW_MS,
    useProbeEnv,
} from './support.js';

useProbeEnv();

const open: NestFastifyApplication[] = [];

async function testApp(options: Partial<Parameters<typeof createTestApp>[0]> = {}) {
    const app = await createTestApp({ module: ProbeModule, service: 'probe', ...options });
    open.push(app);

    return app;
}

afterEach(async () => {
    await Promise.allSettled(open.splice(0).map((app) => app.close()));
});

const NEST_ORDER = [
    'step2:stopping=true',
    'onModuleDestroy',
    'beforeApplicationShutdown',
    'onApplicationShutdown',
    'step4',
];

describe('UC-8: остановка приложения', () => {
    it('§3.5: app.close() — шаги 1–5 без exit, повторный вызов — тот же промис', async () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('exit');
        });
        const app = await testApp();
        const health = app.get(HealthRegistry);

        const first = app.close();
        const second = app.close();
        expect(second).toBe(first);
        await first;

        expect(health.isStopping).toBe(true);
        expect(journal).toEqual(NEST_ORDER);
        expect(exit).not.toHaveBeenCalled();
    });

    it('§3.2: шаг 3 nest после шага 2 — повторное закрытие Fastify без ошибки, хуки модуля в порядке Nest', async () => {
        const app = await testApp();
        await app.listen({ port: 0, host: '127.0.0.1' });
        const server = app.getHttpAdapter().getInstance().server;

        await app.close();

        expect(server.listening).toBe(false);
        expect(journal).toEqual(NEST_ORDER);
    });

    it('§3.5: createHttpApp (путь NestFactory): /health 503 первым, участники шагов 2–3 по разу, повторный вызов не запускает шаги', async () => {
        const app = await createHttpApp({ module: ProbeModule, service: 'probe' });

        await app.close();
        await app.close();

        expect(journal).toEqual(NEST_ORDER);
        expect(app.get(HealthRegistry).isStopping).toBe(true);
    });

    it('§3.2: app.close() на слушающем приложении с keep-alive клиентом завершается не позже ~1 с после ответа', async () => {
        const app = await testApp();
        await app.listen({ port: 0, host: '127.0.0.1' });
        const address = app.getHttpServer().address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        const url = `http://127.0.0.1:${port}`;
        // Прогрев: соединение keep-alive уже открыто и простаивает.
        await (await fetch(`${url}/ok`)).text();

        const slow = fetch(`${url}/slow`);
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS / 3));
        const closing = app.close();
        const res = await slow;
        const answeredAt = performance.now();
        await res.text();
        await closing;

        expect(res.status).toBe(200);
        expect(performance.now() - answeredAt).toBeLessThan(1000);
    });
});

describe('UC-14: createTestApp и ядро', () => {
    it('§3.5: createHttpApp с модулем без KitConfigModule.forRoot отклоняется Error с этим именем, process.exit не вызван', async () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('exit');
        });

        await expect(createHttpApp({ module: NoConfigModule, service: 'probe' })).rejects.toThrow(
            /KitConfigModule\.forRoot/,
        );
        expect(exit).not.toHaveBeenCalled();
    });

    it("§3.8: createTestApp с service: 'Bff_App' — ошибка формата", async () => {
        await expect(createTestApp({ module: ProbeModule, service: 'Bff_App' })).rejects.toThrow(
            /createTestApp: имя сервиса «Bff_App» вне формата/,
        );
    });

    it('§3.8: overrides подменяет провайдер модуля сервиса', async () => {
        const app = await testApp({
            overrides: [{ provide: Greeter, useValue: { greet: () => 'подмена' } }],
        });

        expect(app.get(Greeter).greet()).toBe('подмена');
    });

    it('§3.5: провайдер модуля сервиса внедряет KitLifecycle и HealthRegistry (экспорт ядра)', async () => {
        const app = await testApp();
        const probe = app.get(LifecycleProbe);

        expect(probe.health).toBe(app.get(HealthRegistry));
        expect(probe.lifecycle).toBeDefined();
    });
});
