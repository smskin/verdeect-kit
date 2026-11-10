// startTestStack без Docker (prd.md §3.8, AC-1.12): проверка имени и запуск без флагов.
import { describe, expect, it, vi } from 'vitest';
import { startTestStack } from '../../../src/testing/start-test-stack.js';

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
});
