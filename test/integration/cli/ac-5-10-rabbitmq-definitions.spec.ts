// AC-5.10 (UC-12): definitions.json из CLI verdeect-kit rabbitmq definitions загружается в брокер — пользователь сервиса
// входит, exchange verdeect.events виден пассивной проверкой (prd.md §3.4 M3). Операции relay/подписчика и
// ACCESS_REFUSED — test/integration/messaging/ac-5-10-permissions.spec.ts.
import { randomBytes } from 'node:crypto';
import amqp from 'amqplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rabbitmqCommand } from '../../../src/cli/commands/rabbitmq.js';
import {
    EVENTS_EXCHANGE,
    hashRabbitPassword,
    type RabbitDefinitions,
} from '../../../src/internal/rabbitmq-definitions.js';
import { brokerAdmin, workerBroker } from '../../support/broker.js';

describe('UC-12: definitions.json в брокере', () => {
    beforeEach(() => {
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('AC-5.10: definitions из CLI загружаются в брокер — пользователь входит, exchange verdeect.events виден пассивной проверкой', async () => {
        const password = randomBytes(8).toString('hex');
        const output: string[] = [];
        const code = await rabbitmqCommand(['definitions', '--services', 'kitcli'], {
            cwd: process.cwd(),
            write: (text) => void output.push(text),
            env: {
                LOG_LEVEL: 'silent',
                RABBITMQ_PASSWORD_HASH_KITCLI: hashRabbitPassword(password),
            },
        });
        expect(code).toBe(0);
        const definitions = JSON.parse(output.join('')) as RabbitDefinitions;
        const vhost = `kit-test-cli-${randomBytes(4).toString('hex')}`;
        const admin = brokerAdmin();
        try {
            // CLI пишет vhost `/`; тест грузит тот же файл в свой vhost.
            await admin.loadDefinitions({
                ...definitions,
                vhosts: [{ name: vhost }],
                permissions: definitions.permissions.map((item) => ({ ...item, vhost })),
                exchanges: definitions.exchanges.map((item) => ({ ...item, vhost })),
            });
            const url = new URL(workerBroker().url);
            url.username = 'kitcli';
            url.password = password;
            url.pathname = `/${encodeURIComponent(vhost)}`;
            const connection = await amqp.connect(url.toString());
            try {
                const channel = await connection.createChannel();
                await expect(channel.checkExchange(EVENTS_EXCHANGE)).resolves.toBeDefined();
            } finally {
                await connection.close();
            }
        } finally {
            await admin.deleteVhost(vhost);
            await admin.deleteUser('kitcli');
        }
    });

    it('AC-5.10: CLI без ключа RABBITMQ_PASSWORD_HASH_<SVC> одного из --services → INVALID_ENVIRONMENT с именем ключа, значений в выводе нет, выход 1', async () => {
        const hash = hashRabbitPassword(randomBytes(8).toString('hex'));
        const output: string[] = [];
        const code = await rabbitmqCommand(['definitions', '--services', 'kitcli,kitcli-b'], {
            cwd: process.cwd(),
            write: (text) => void output.push(text),
            env: { LOG_LEVEL: 'silent', RABBITMQ_PASSWORD_HASH_KITCLI: hash },
        });

        expect(code).toBe(1);
        expect(JSON.parse(output.join(''))).toEqual({
            error: {
                code: 'INVALID_ENVIRONMENT',
                message: 'Неверное окружение',
                keys: ['RABBITMQ_PASSWORD_HASH_KITCLI_B'],
            },
        });
        expect(output.join('')).not.toContain(hash);
    });
});
