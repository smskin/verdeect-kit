// AC-5.11 (U; prd.md §3.4 v1.26, UC-8): срок обработчиков остановки отсчитывается от начала остановки —
// min(max(1000, T − D − 3000), остаток − 3000); остаток < 3000 → 0; остаток неизвестен — max(1000, T − D − 3000).
// Функция срока — src/messaging/topology.ts (handlersDeadlineMs); реальные сроки — test/timing/messaging.
// v1.31 (§3.8 стр. 191): срок запоминается, только если остановка KitLifecycle началась.
import { describe, expect, it } from 'vitest';
import { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { handlersDeadlineMs } from '../../../src/messaging/topology.js';

const env = (T: number, D: number) => ({ SHUTDOWN_TIMEOUT_MS: T, SHUTDOWN_DRAIN_MS: D });

describe('UC-8: shutdownDeadline', () => {
    it('AC-5.11: умолчания и быстрый шаг 2 — 7000', () => {
        expect(handlersDeadlineMs(env(15_000, 5_000), 10_000)).toBe(7_000);
    });

    it('AC-5.11: T = 10000, D = 0, шаг 2 = 5 с — 2000', () => {
        expect(handlersDeadlineMs(env(10_000, 0), 5_000)).toBe(2_000);
    });

    it('AC-5.11: остаток 2999 — 0, остаток 3000 — 0', () => {
        expect(handlersDeadlineMs(env(10_000, 0), 2_999)).toBe(0);
        expect(handlersDeadlineMs(env(10_000, 0), 3_000)).toBe(0);
    });

    it('AC-5.11: нижняя граница 1000 действует только на первую часть формулы', () => {
        expect(handlersDeadlineMs(env(4_000, 1_000), 60_000)).toBe(1_000);
        expect(handlersDeadlineMs(env(4_000, 1_000), 3_500)).toBe(500);
    });

    it('AC-5.11: остаток неизвестен (остановка не через KitLifecycle) — max(1000, T − D − 3000)', () => {
        expect(handlersDeadlineMs(env(10_000, 0), undefined)).toBe(7_000);
        expect(handlersDeadlineMs(env(2_000, 1_500))).toBe(1_000);
    });

    it('AC-5.11: до начала остановки KitLifecycle срок не запоминается — после начала берётся новый', () => {
        let started = false;
        const silent = {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        };
        // Конструктор соединений не открывает: соединение открывает только start().
        const connection = new RabbitConnection({
            url: 'amqp://127.0.0.1:1',
            reconnectSeconds: 1,
            deadlineMs: () => 60_000,
            stopStarted: () => started,
            log: silent,
        });

        const early = [connection.shutdownDeadline(), connection.shutdownDeadline()];
        started = true;
        const late = [connection.shutdownDeadline(), connection.shutdownDeadline()];

        expect(early[0]).not.toBe(early[1]);
        expect(late[0]).toBe(late[1]);
        expect(late[0]).not.toBe(early[0]);
        expect(late[0]).not.toBe(early[1]);
    });
});
