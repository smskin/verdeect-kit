// AC-8.6 (UC-12; NFR-4, prd.md §3.7 стр. 171 v1.31): в логах KitRedisChannels (debug и error) — только вид канала
// (channelKind — сегмент до первого «:»), без полного имени с идентификаторами; в событии GlitchTip имени канала нет.
// Проект isolated: initFakeSentry — процесс-глобальный Sentry.
import * as Sentry from '@sentry/nestjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_REDIS_LOG, KIT_REDIS_PREFIX } from '../../../src/internal/tokens.js';
import { KitRedisChannels } from '../../../src/redis/channels.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import { waitUntil } from '../../support/messaging.js';
import { createRedisApp } from '../../support/redis.js';

const CHANNEL = 'kind:t-1:42';
/** Части имени канала с идентификаторами: их нет в логах и событии. */
const CHANNEL_PARTS = ['t-1:42', 'kind:t-1'];

/** Поля события GlitchTip, где могло бы оказаться имя канала: `exception` и `message` элементов конверта. */
function eventFields(body: string): unknown[] {
    return body
        .split('\n')
        .filter((line) => line.trim().startsWith('{'))
        .map((line) => JSON.parse(line) as { exception?: unknown; message?: unknown })
        .filter((item) => item.exception !== undefined || item.message !== undefined)
        .map((item) => ({ exception: item.exception, message: item.message }));
}

/** Перехватчик логов /redis: вызовы debug и error. */
function captureLog(): { readonly calls: unknown[]; readonly log: object } {
    const calls: unknown[] = [];
    const record =
        (level: string) =>
        (fields: object, message: string): void =>
            void calls.push({ level, fields, message });

    return {
        calls,
        log: {
            debug: record('debug'),
            info: record('info'),
            warn: record('warn'),
            error: record('error'),
        },
    };
}

describe('UC-12: вид канала в логах Redis', () => {
    let delivered: DeliveredEvent[];

    beforeAll(() => {
        delivered = initFakeSentry().delivered;
    });

    afterAll(async () => {
        await Sentry.close(1000);
    });

    it('AC-8.6: подписка, публикация и отказ SUBSCRIBE канала kind:t-1:42 → в перехваченных логах kind, подстрок t-1 и 42 нет, в событии GlitchTip имени канала нет', async () => {
        const ok = captureLog();
        const denied = captureLog();
        const app = await createRedisApp({
            options: { subscriber: true },
            overrides: [{ provide: KIT_REDIS_LOG, useValue: ok.log }],
        });
        // Префикс вне прав ACL сервиса kit (~kit:* &kit:*): SUBSCRIBE other:… → NOPERM.
        const deniedApp = await createRedisApp({
            options: { subscriber: true },
            overrides: [
                { provide: KIT_REDIS_PREFIX, useValue: 'other:' },
                { provide: KIT_REDIS_LOG, useValue: denied.log },
            ],
        });
        await app.init();
        await deniedApp.init();
        try {
            const channels = app.get(KitRedisChannels);
            let received = 0;
            const unsubscribe = await channels.subscribe(CHANNEL, () => {
                received += 1;
                throw new Error('обработчик упал');
            });
            await channels.publish(CHANNEL, 'm');
            await waitUntil(
                () =>
                    Promise.resolve(
                        ok.calls.some((call) => JSON.stringify(call).includes('"error"')),
                    ),
                'ошибка обработчика в логе',
            );
            await unsubscribe();
            await expect(
                deniedApp.get(KitRedisChannels).subscribe(CHANNEL, () => undefined),
            ).rejects.toThrow();
            await Sentry.flush(1000);

            const logs = [...ok.calls, ...denied.calls];
            const channelLogs = logs.filter((call) =>
                /канал/.test((call as { message: string }).message),
            );
            const logsText = JSON.stringify(logs);
            const eventText = JSON.stringify(delivered.map((item) => eventFields(item.body)));
            expect(received).toBe(1);
            expect(delivered).toHaveLength(1);
            expect(eventText).toContain('обработчик упал');
            // Имя канала с идентификаторами — ни в логах, ни в exception/message события (числа конверта — не канал).
            for (const name of CHANNEL_PARTS) {
                expect(logsText).not.toContain(name);
                expect(eventText).not.toContain(name);
            }
            // Подписка, ошибка обработчика, отписка, отказ подписки.
            expect(channelLogs).toHaveLength(4);
            for (const call of channelLogs) {
                expect((call as { fields: { channelKind?: string } }).fields.channelKind).toBe(
                    'kind',
                );
            }
        } finally {
            await deniedApp.close();
            await app.close();
        }
    });
});
