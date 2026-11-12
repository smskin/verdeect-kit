// AC-5.10 (UC-12): definitions.json из CLI verdeect-kit rabbitmq definitions загружается в брокер — пользователь сервиса
// входит, exchange verdeect.events виден пассивной проверкой; публикация — только с ключом префикса --publishes, без
// --publishes и вне префикса — ACCESS_REFUSED (prd.md §3.4 M3, v1.20). Операции relay/подписчика и
// ACCESS_REFUSED — test/integration/messaging/ac-5-10-permissions.spec.ts.
import { randomBytes } from 'node:crypto';
import amqp from 'amqplib';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { rabbitmqCommand } from '../../../src/cli/commands/rabbitmq.js';
import {
    EVENTS_EXCHANGE,
    hashRabbitPassword,
    passwordHashKey,
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

    /** definitions из CLI в свой vhost (CLI пишет vhost `/`), операция пользователем `service` на канале с подтверждениями. */
    async function withCliUser(
        args: readonly string[],
        services: readonly string[],
        work: (channel: amqp.ConfirmChannel, service: string, password: string) => Promise<void>,
        /** Администратор `--admin`: пароль тот же, проверяется вместе с сервисами. */
        adminUser?: string,
    ): Promise<void> {
        const password = randomBytes(8).toString('hex');
        const env: Record<string, string> = { LOG_LEVEL: 'silent' };
        const users = adminUser === undefined ? services : [...services, adminUser];
        for (const service of users) {
            env[passwordHashKey(service)] = hashRabbitPassword(password);
        }
        const output: string[] = [];
        const code = await rabbitmqCommand(
            [
                'definitions',
                '--services',
                services.join(','),
                ...args,
                ...(adminUser === undefined ? [] : ['--admin', adminUser]),
            ],
            { cwd: process.cwd(), write: (text) => void output.push(text), env },
        );
        expect(code).toBe(0);
        const definitions = JSON.parse(output.join('')) as RabbitDefinitions;
        const vhost = `kit-test-cli-${randomBytes(4).toString('hex')}`;
        const admin = brokerAdmin();
        try {
            await admin.loadDefinitions({
                ...definitions,
                vhosts: [{ name: vhost }],
                permissions: definitions.permissions.map((item) => ({ ...item, vhost })),
                topic_permissions: definitions.topic_permissions.map((item) => ({
                    ...item,
                    vhost,
                })),
                exchanges: definitions.exchanges.map((item) => ({ ...item, vhost })),
            });
            for (const service of users) {
                const url = new URL(workerBroker().url);
                url.username = service;
                url.password = password;
                url.pathname = `/${encodeURIComponent(vhost)}`;
                const connection = await amqp.connect(url.toString());
                connection.on('error', () => undefined);
                try {
                    const channel = await connection.createConfirmChannel();
                    channel.on('error', () => undefined);
                    await work(channel, service, password);
                } finally {
                    await connection.close().catch(() => undefined);
                }
            }
        } finally {
            await admin.deleteVhost(vhost);
            await Promise.all(users.map((service) => admin.deleteUser(service)));
        }
    }

    /** Публикация в verdeect.events с ожиданием подтверждения; отказ брокера — текст. */
    async function publish(channel: amqp.ConfirmChannel, key: string): Promise<string> {
        // Причина закрытия канала (ACCESS_REFUSED) приходит событием; отказ подтверждения — только «channel closed».
        let closed: Error | undefined;
        channel.once('error', (error: Error) => {
            closed = error;
        });
        try {
            channel.publish(EVENTS_EXCHANGE, key, Buffer.from('{}'));
            await channel.waitForConfirms();

            return 'ok';
        } catch (error) {
            return String((closed ?? (error as Error)).message);
        }
    }

    it('AC-5.10: definitions из CLI загружаются в брокер — пользователь входит, exchange verdeect.events виден пассивной проверкой', async () => {
        await withCliUser([], ['kitcli'], async (channel) => {
            await expect(channel.checkExchange(EVENTS_EXCHANGE)).resolves.toBeDefined();
        });
    });

    it('AC-5.10: сервис с --publishes kitcli.,audit.kitcli. публикует с ключом своего префикса', async () => {
        await withCliUser(
            ['--publishes', 'kitcli=kitcli.,audit.kitcli.'],
            ['kitcli'],
            async (channel) => {
                expect(await publish(channel, 'kitcli.note.created')).toBe('ok');
                expect(await publish(channel, 'audit.kitcli.x')).toBe('ok');
            },
        );
    });

    it('AC-5.10: сервис с --publishes — ключ вне префикса → ACCESS_REFUSED', async () => {
        await withCliUser(['--publishes', 'kitcli=kitcli.'], ['kitcli'], async (channel) => {
            expect(await publish(channel, 'identity.user.created')).toMatch(/ACCESS_REFUSED|403/);
        });
    });

    it('AC-5.10: сервис без --publishes → публикация в verdeect.events ACCESS_REFUSED', async () => {
        await withCliUser(
            ['--publishes', 'kitcli=kitcli.'],
            ['kitcli', 'kitcli-ro'],
            async (channel, service) => {
                if (service === 'kitcli-ro') {
                    expect(await publish(channel, 'kitcli.note.created')).toMatch(
                        /ACCESS_REFUSED|403/,
                    );
                }
            },
        );
    });

    it('AC-5.10: --admin kitcli-adm — администратор в брокере: тег administrator (management API 200), любая очередь объявляется и публикация с любым ключом проходит', async () => {
        await withCliUser(
            [],
            ['kitcli'],
            async (channel, user, password) => {
                if (user !== 'kitcli-adm') {
                    return;
                }
                await expect(
                    channel.assertQueue('kitcli-adm-any', { exclusive: true }),
                ).resolves.toBeDefined();
                expect(await publish(channel, 'identity.user.created')).toBe('ok');
                const managementUrl = inject('kitRabbitmqManagementUrl') ?? '';
                const response = await fetch(new URL('api/whoami', managementUrl), {
                    headers: {
                        authorization: `Basic ${Buffer.from(`kitcli-adm:${password}`).toString('base64')}`,
                    },
                });
                expect(response.status).toBe(200);
                expect(((await response.json()) as { tags: string[] | string }).tags).toContain(
                    'administrator',
                );
            },
            'kitcli-adm',
        );
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
