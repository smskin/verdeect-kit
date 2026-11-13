// AC-5.10 (UC-12): topic-права пользователя воркера на verdeect.events и пересоздание exchange в тестах — предпосылка
// declareEventsExchange (брокер удаляет topic-права вместе с exchange) и восстановление прав: после пересоздания
// публикация с ключом вне префикса снова ACCESS_REFUSED (prd.md §3.4 M3, v1.20; KT-62). declareEventsExchange — экспорт
// /testing (§3.8 v1.26).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTS_EXCHANGE, topicPermissionsOf } from '../../../src/internal/rabbitmq-definitions.js';
import { declareEventsExchange } from '../../../src/testing/index.js';
import { asWorker, BrokerClient, topicPermissions, workerBroker } from '../../support/broker.js';

/** Публикация пользователем воркера с подтверждением. */
function publishAsWorker(key: string): Promise<string> {
    return asWorker(async (channel) => {
        channel.publish(EVENTS_EXCHANGE, key, Buffer.from('{}'));
        await channel.waitForConfirms();
    });
}

describe('UC-12: topic-права при пересоздании verdeect.events', () => {
    let broker: BrokerClient;
    // Пользователь воркера назван как его vhost (prepareWorkerVhosts).
    const { vhost } = workerBroker();

    beforeAll(async () => {
        broker = await BrokerClient.connect();
    });

    afterAll(async () => {
        await declareEventsExchange();
        await broker.close();
    });

    it('AC-5.10: удаление exchange удаляет topic-права пользователя на него (предпосылка declareEventsExchange)', async () => {
        const before = await topicPermissions(vhost, vhost);
        expect(before).toContainEqual(
            expect.objectContaining({ exchange: EVENTS_EXCHANGE, ...topicPermissionsOf(['kit.']) }),
        );

        await broker.deleteExchange(EVENTS_EXCHANGE);

        expect(
            (await topicPermissions(vhost, vhost)).filter(
                (item) => item.exchange === EVENTS_EXCHANGE,
            ),
        ).toEqual([]);
    });

    it('AC-5.10: после удаления exchange и declareEventsExchange() публикация воркера по своему префиксу проходит, по чужому — ACCESS_REFUSED', async () => {
        await broker.deleteExchange(EVENTS_EXCHANGE);
        await declareEventsExchange();

        expect(
            (await topicPermissions(vhost, vhost)).filter(
                (item) => item.exchange === EVENTS_EXCHANGE,
            ),
        ).toEqual([
            expect.objectContaining({ exchange: EVENTS_EXCHANGE, ...topicPermissionsOf(['kit.']) }),
        ]);
        expect(await publishAsWorker('platform.note.created')).toMatch(/ACCESS_REFUSED/);
        expect(await publishAsWorker('kit.note.created')).toBe('ok');
    });
});
