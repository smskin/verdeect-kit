// AC-5.18 (UC-14): vhost и пользователь на воркер из startTestStack — пользователь входит только в свой vhost; остатки
// прошлых прогонов удаляются до создания; teardown удаляет всё с префиксом (prd.md §3.8; П2). Эталон — B
// test/support/broker.ts (BrokerAdmin).
import { randomBytes } from 'node:crypto';
import amqp from 'amqplib';
import { describe, expect, it } from 'vitest';
import { deleteTestVhosts, prepareWorkerVhosts } from '../../../src/testing/rabbitmq-admin.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { brokerAdmin, workerBroker } from '../../support/broker.js';
import { hashRabbitPassword } from '../../../src/internal/rabbitmq-definitions.js';

describe('UC-14: vhost воркера', () => {
    it('AC-5.18: workerScope().rabbitmq — vhost воркера с префиксом kit-test-, пользователь воркера входит только в свой vhost', async () => {
        const { vhost, url } = workerScope().rabbitmq;

        expect(vhost).toMatch(/^kit-test-[0-9a-f]{8}-w\d+$/);
        const connection = await amqp.connect(url);
        await connection.close();

        const root = new URL(url);
        root.pathname = '/';
        // amqplib 2.2.0: брокер закрывает соединение (530 NOT_ALLOWED) вместо ConnectionOpenOk.
        await expect(amqp.connect(root.toString())).rejects.toThrow(
            /ConnectionOpenOk; got <ConnectionClose|NOT_ALLOWED|ACCESS_REFUSED/,
        );
    });

    it('AC-5.18: teardown удаляет vhost и пользователей с префиксом; vhost прошлого прогона удаляется до создания новых', async () => {
        const admin = brokerAdmin();
        const old = 'kitvh-test-old-w1';
        await admin.loadDefinitions({
            rabbit_version: '4.3.6',
            vhosts: [{ name: old }],
            users: [
                {
                    name: old,
                    password_hash: hashRabbitPassword('x'),
                    hashing_algorithm: 'rabbit_password_hashing_sha256',
                    tags: [],
                },
            ],
            permissions: [],
            topic_permissions: [],
            exchanges: [],
            queues: [],
            bindings: [],
        });
        const runId = randomBytes(4).toString('hex');

        const prepared = await prepareWorkerVhosts(admin, {
            service: 'kitvh',
            workers: 2,
            runId,
            amqpAdminUrl: workerBroker().adminUrl,
        });

        expect(prepared.removed).toEqual([old]);
        expect(prepared.workers.map((worker) => worker.vhost)).toEqual([
            `kitvh-test-${runId}-w1`,
            `kitvh-test-${runId}-w2`,
        ]);
        const vhosts = await admin.listVhosts();
        expect(vhosts).not.toContain(old);
        expect(vhosts).toContain(`kitvh-test-${runId}-w2`);
        const second = await amqp.connect(prepared.workers[1]?.url ?? '');
        await second.close();

        expect(await deleteTestVhosts(admin, 'kitvh-test-')).toEqual({ vhosts: 2, users: 2 });
        expect((await admin.listVhosts()).filter((name) => name.startsWith('kitvh-test-'))).toEqual(
            [],
        );
        expect((await admin.listUsers()).filter((name) => name.startsWith('kitvh-test-'))).toEqual(
            [],
        );
    });
});
