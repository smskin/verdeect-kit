// startTestStack без Docker (prd.md §3.8, AC-1.12): проверка имени, запуск без флагов, число воркеров для vhost (E5).
import { availableParallelism } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { maxWorkersOf, startTestStack } from '../../../src/testing/start-test-stack.js';

describe('UC-14: тестовый контур', () => {
    it('§3.8: startTestStack — имя сервиса вне формата → TypeError при вызове', () => {
        expect(() => startTestStack({ service: 'Kit' })).toThrow(TypeError);
        expect(() => startTestStack({ service: 'k' })).toThrow(/^startTestStack: /);
    });

    it('AC-1.12: без флагов — ни одного контейнера и provide не вызывается', async () => {
        const project = { provide: vi.fn() };

        const teardown = await startTestStack({ service: 'kit-unit' })(project as never);
        await teardown();

        expect(project.provide).not.toHaveBeenCalled();
    });

    it('§3.8: maxWorkersOf — число → оно же (наибольшее по проектам), строка-процент и undefined → os.availableParallelism()', () => {
        expect(maxWorkersOf([{ maxWorkers: 3 }, { maxWorkers: 1 }])).toBe(3);
        expect(maxWorkersOf([{ maxWorkers: '50%' }])).toBe(Math.max(1, availableParallelism()));
        expect(maxWorkersOf([{}])).toBe(Math.max(1, availableParallelism()));
    });

    it('AC-5.13: KIT_OUTBOX_COVERAGE=1 без outboxEvents — teardown не бросает', async () => {
        vi.stubEnv('KIT_OUTBOX_COVERAGE', '1');
        const project = { provide: vi.fn() };
        try {
            const teardown = await startTestStack({ service: 'kit-unit' })(project as never);

            await expect(teardown()).resolves.toBeUndefined();
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
