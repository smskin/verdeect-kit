// AC-5.19 (UC-6): kit.retry объявлена с другим TTL — запуск отклонён MessagingStartupError «очередь kit.retry
// объявлена с другим TTL — пересоздайте очередь», без цикла переподключений (prd.md §3.4; П8).
import { afterAll, describe, expect, it } from 'vitest';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { MessagingStartupError } from '../../../src/messaging/errors.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { BrokerClient } from '../../support/broker.js';
import { createSubscriberApp, memoryLogger, resetQueues } from '../../support/messaging.js';

describe('UC-6: TTL очереди повтора', () => {
    const broker = BrokerClient.connect();

    afterAll(async () => {
        await (await broker).close();
    });

    it('AC-5.19: kit.retry объявлена с другим TTL — запуск отклонён MessagingStartupError «очередь kit.retry объявлена с другим TTL — пересоздайте очередь», без цикла переподключений', async () => {
        const client = await broker;
        await resetQueues();
        await client.channel.assertQueue('kit.retry', {
            durable: true,
            messageTtl: 99_000,
            deadLetterExchange: '',
            deadLetterRoutingKey: 'kit',
        });
        const { logger, lines } = memoryLogger();
        try {
            // createTestApp вызывает init(): отказ onApplicationBootstrap отклоняет сборку стенда (до listen).
            const error: unknown = await createSubscriberApp({
                overrides: [{ provide: KIT_LOGGER, useValue: logger }],
            }).catch((reason: unknown) => reason);
            const refusedAt = Date.now();

            // Отсчёт — от события «соединение установлено» (время строки pino), не от сборки приложения Nest: отказ —
            // в пределах одной паузы RABBITMQ_RETRY_SECONDS = 1 с × scale, без цикла переподключений.
            const connected = lines.find(
                (line) => line['msg'] === 'rabbitmq: соединение установлено',
            );
            expect(connected, 'соединение с брокером установлено').toBeDefined();
            expect(refusedAt - Number(connected?.['time'])).toBeLessThan(1000 * TEST_TIMEOUT_SCALE);
            expect(error).toBeInstanceOf(MessagingStartupError);
            expect((error as MessagingStartupError).startupCode).toBe(
                'MESSAGING_RETRY_TTL_MISMATCH',
            );
            expect((error as Error).message).toBe(
                'очередь kit.retry объявлена с другим TTL — пересоздайте очередь',
            );
            const fatal = lines.filter(
                (line) =>
                    line['msg'] ===
                    'rabbitmq: фатальная ошибка настройки канала, повторов не будет',
            );
            expect(fatal).toHaveLength(1);
            expect(
                lines.filter((line) => line['msg'] === 'rabbitmq: канал открывается заново'),
            ).toHaveLength(0);
            expect(
                lines.filter((line) => line['msg'] === 'rabbitmq: попытка подключения не удалась'),
            ).toHaveLength(0);
        } finally {
            await client.deleteQueue('kit.retry').catch(() => undefined);
        }
    });
});
