// §3.4 (UC-6), AC-5.10: соединение /messaging на настоящем брокере — exchange verdeect.events проверяется пассивно
// (не объявляется), проба rabbitmq некритичная, соединение закрывается на шаге 4. Эквивалентность — O
// topology.int-spec «exchange verdeect.events не объявляется».
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { HealthRegistry } from '../../../src/observability/health-registry.js';
import { declareEventsExchange } from '../../../src/testing/index.js';
import { BrokerClient } from '../../support/broker.js';
import { createMessagingApp, waitUntil } from '../../support/messaging.js';

async function rabbitmqCheck(app: NestFastifyApplication): Promise<string | undefined> {
    return (await app.get(HealthRegistry).evaluate()).checks['rabbitmq'];
}

describe('UC-6: соединение RabbitMQ', () => {
    let broker: BrokerClient;
    let app: NestFastifyApplication | undefined;

    beforeAll(async () => {
        broker = await BrokerClient.connect();
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        await declareEventsExchange();
    });

    afterAll(async () => {
        await broker.close();
    });

    it('§3.4: exchange verdeect.events проверяется пассивно — при удалённом exchange сервис его не объявляет, /health degraded, rabbitmq down', async () => {
        await broker.deleteExchange('verdeect.events');
        app = await createMessagingApp({ options: { subscriber: { dedupe: 'none' } } });
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        const probe = connection.createChannel({ name: 'probe', confirm: true });
        try {
            expect((await connection.channelOutcome('probe')).kind).toBe('failed');
            await waitUntil(
                async () => (await rabbitmqCheck(app as NestFastifyApplication)) === 'down',
                'rabbitmq down',
            );

            const report = await app.get(HealthRegistry).evaluate();
            expect(report.status).toBe('degraded');
            expect(await broker.exchangeExists('verdeect.events')).toBe(false);
        } finally {
            await probe.close();
        }
    });

    it('§3.4: с exchange — канал probe готов, rabbitmq up, topologyReady', async () => {
        app = await createMessagingApp({ options: { subscriber: { dedupe: 'none' } } });
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        const probe = connection.createChannel({ name: 'probe', confirm: true });
        try {
            expect(await connection.channelOutcome('probe')).toEqual({ kind: 'ready' });
            await waitUntil(
                async () => (await rabbitmqCheck(app as NestFastifyApplication)) === 'up',
                'rabbitmq up',
            );
            expect(connection.topologyReady()).toBe(true);
        } finally {
            await probe.close();
        }
    });

    it('§3.4: модуль без каналов при живом соединении — rabbitmq up', async () => {
        app = await createMessagingApp({ options: {} });
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);

        expect(await connection.firstAttempt()).toBe('connected');
        await waitUntil(
            async () => (await rabbitmqCheck(app as NestFastifyApplication)) === 'up',
            'rabbitmq up',
        );
    });

    it('§3.4: модуль без outbox и subscriber не открывает каналов, соединение закрывается на шаге 4', async () => {
        const local = await createMessagingApp({ options: {} });
        await local.init();
        const connection = local.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await connection.firstAttempt();
        expect(connection.isConnected()).toBe(true);
        expect(connection.topologyReady()).toBe(true);

        await local.close();

        expect(connection.isConnected()).toBe(false);
    });
});
