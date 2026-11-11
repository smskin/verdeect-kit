// workerScope (prd.md §3.8 v1.14, UC-14, AC-5.18): tenant — слаг компании воркера, rabbitmq — vhost воркера;
// src/testing/worker-scope.ts.
import { describe, expect, it } from 'vitest';
import { workerScope, workerScopeWith } from '../../../src/testing/worker-scope.js';

describe('UC-14: workerScope', () => {
    it('§3.8: tenant — слаг ^[a-z0-9][a-z0-9-]{0,48}$, начинается с w<VITEST_POOL_ID>-', () => {
        const { tenant } = workerScope();

        expect(tenant).toMatch(/^[a-z0-9][a-z0-9-]{0,48}$/);
        expect(tenant).toMatch(new RegExp(`^w${process.env.VITEST_POOL_ID ?? '0'}-[0-9a-f]{8}$`));
    });

    it('§3.8: повторный вызов в воркере — то же значение', () => {
        expect(workerScope()).toBe(workerScope());
    });

    it('§3.8: workerScope().rabbitmq без kitRabbitmqWorkers → TypeError «startTestStack запущен без rabbitmq: true»', () => {
        const scope = workerScopeWith(() => undefined);

        expect(() => scope.rabbitmq).toThrow(/startTestStack запущен без rabbitmq: true/);
        expect(scope.tenant).toMatch(/^w/);
    });

    it('§3.8: нет записи для VITEST_POOL_ID → TypeError с номером воркера', () => {
        const pool = process.env.VITEST_POOL_ID ?? '1';

        expect(() => workerScopeWith(() => []).rabbitmq).toThrow(
            new RegExp(`нет vhost для воркера ${pool} \\(vhost в стеке: 0\\)`),
        );
    });

    it('AC-5.18: rabbitmq — vhost и url записи воркера VITEST_POOL_ID', () => {
        const pool = Number(process.env.VITEST_POOL_ID ?? '1');
        const workers = Array.from({ length: pool }, (_, index) => ({
            vhost: `kit-test-r-w${index + 1}`,
            url: `amqp://u@h/w${index + 1}`,
            adminUrl: 'amqp://a@h/x',
        }));

        expect(workerScopeWith(() => workers).rabbitmq).toEqual({
            vhost: `kit-test-r-w${pool}`,
            url: `amqp://u@h/w${pool}`,
        });
    });
});
