// AC-1.15 (UC-14; prd.md §3.8 v1.26): workerScope().rabbitmq.adminUrl — администратор vhost воркера с полными правами:
// подключение amqplib и объявление exchange в vhost воркера (видно через management API).
import amqp from 'amqplib';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { workerScope } from '../../../src/testing/worker-scope.js';

const EXCHANGE = 'kit.ac-1-15.probe';

/** Exchange vhost по management API (Basic auth администратора из kitRabbitmqUrl); нет — null. */
async function managementExchange(vhost: string, name: string): Promise<unknown> {
    const managementUrl = inject('kitRabbitmqManagementUrl');
    const adminUrl = new URL(inject('kitRabbitmqUrl') ?? '');
    const auth = Buffer.from(
        `${decodeURIComponent(adminUrl.username)}:${decodeURIComponent(adminUrl.password)}`,
    ).toString('base64');
    const response = await fetch(
        new URL(
            `api/exchanges/${encodeURIComponent(vhost)}/${encodeURIComponent(name)}`,
            managementUrl,
        ),
        { headers: { authorization: `Basic ${auth}` } },
    );
    if (response.status === 404) {
        return null;
    }

    return response.json();
}

describe('UC-14: adminUrl воркера', () => {
    const { vhost, adminUrl } = workerScope().rabbitmq;

    afterAll(async () => {
        const connection = await amqp.connect(adminUrl);
        try {
            const channel = await connection.createChannel();
            await channel.deleteExchange(EXCHANGE);
        } finally {
            await connection.close();
        }
    });

    it('AC-1.15: workerScope().rabbitmq.adminUrl подключается и объявляет exchange в vhost воркера', async () => {
        const connection = await amqp.connect(adminUrl);
        try {
            const channel = await connection.createChannel();
            await channel.assertExchange(EXCHANGE, 'topic', { durable: false, autoDelete: false });
        } finally {
            await connection.close();
        }

        expect(await managementExchange(vhost, EXCHANGE)).toMatchObject({
            name: EXCHANGE,
            vhost,
            type: 'topic',
        });
    });
});
