// AC-5.10, UC-12 (U): definitions.json — права M3, exchange verdeect.events, хеш пароля, ключ окружения (prd.md §3.4);
// src/internal/rabbitmq-definitions.ts. Эталон прав — O docs/messaging.md (or-119).
import { describe, expect, it } from 'vitest';
import {
    buildDefinitions,
    hashRabbitPassword,
    passwordHashKey,
    permissionsOf,
} from '../../../src/internal/rabbitmq-definitions.js';

describe('UC-12: definitions.json', () => {
    it('AC-5.10: permissionsOf(orchestrator) — configure ^orchestrator(\\..*)?$, write и read с verdeect.events (+ amq.default у write)', () => {
        expect(permissionsOf('orchestrator')).toEqual({
            configure: '^orchestrator(\\..*)?$',
            write: '^(verdeect\\.events|amq\\.default|orchestrator(\\..*)?)$',
            read: '^(verdeect\\.events|orchestrator(\\..*)?)$',
        });
    });

    it('AC-5.10: регулярки permissionsOf принимают свои очереди и отклоняют чужие', () => {
        const { configure, write, read } = permissionsOf('orchestrator');
        const own = [
            'orchestrator',
            'orchestrator.retry',
            'orchestrator.dlq',
            'orchestrator.replica.r-1',
        ];
        const foreign = ['platform', 'orchestratorx', 'platform.retry'];
        for (const pattern of [configure, write, read]) {
            const regexp = new RegExp(pattern);
            expect(
                own.every((name) => regexp.test(name)),
                pattern,
            ).toBe(true);
            expect(
                foreign.some((name) => regexp.test(name)),
                pattern,
            ).toBe(false);
        }
        expect(new RegExp(configure).test('verdeect.events')).toBe(false);
        expect(new RegExp(write).test('amq.default')).toBe(true);
        expect(new RegExp(read).test('verdeect.events')).toBe(true);
    });

    it('§3.4: buildDefinitions — exchange verdeect.events topic durable, пользователь = сервис, очередей нет', () => {
        const definitions = buildDefinitions({
            users: [{ service: 'bff-app', passwordHash: 'h' }],
        });

        expect(definitions.vhosts).toEqual([{ name: '/' }]);
        expect(definitions.users).toEqual([
            {
                name: 'bff-app',
                password_hash: 'h',
                hashing_algorithm: 'rabbit_password_hashing_sha256',
                tags: [],
            },
        ]);
        expect(definitions.permissions).toEqual([
            { user: 'bff-app', vhost: '/', ...permissionsOf('bff-app') },
        ]);
        expect(definitions.exchanges).toEqual([
            {
                name: 'verdeect.events',
                vhost: '/',
                type: 'topic',
                durable: true,
                auto_delete: false,
                internal: false,
                arguments: {},
            },
        ]);
        expect(definitions.queues).toEqual([]);
        expect(definitions.bindings).toEqual([]);
    });

    it('§3.4: buildDefinitions — дубликат или имя вне формата → TypeError', () => {
        expect(() =>
            buildDefinitions({
                users: [
                    { service: 'kit', passwordHash: 'h' },
                    { service: 'kit', passwordHash: 'h' },
                ],
            }),
        ).toThrow(/rabbitmq definitions: сервис kit указан дважды/);
        expect(() =>
            buildDefinitions({ users: [{ service: 'Bad_Name', passwordHash: 'h' }] }),
        ).toThrow(TypeError);
    });

    it('§3.4: hashRabbitPassword — известный вектор документации RabbitMQ', () => {
        expect(hashRabbitPassword('test12', Buffer.from('908DC60A', 'hex'))).toBe(
            'kI3GCqW5JLMJa4iX1lo7X4D6XbYqlLgxIs30+P6tENUV2POR',
        );
        expect(hashRabbitPassword('x')).not.toBe(hashRabbitPassword('x'));
    });

    it('§3.4: passwordHashKey(bff-app) → RABBITMQ_PASSWORD_HASH_BFF_APP', () => {
        expect(passwordHashKey('bff-app')).toBe('RABBITMQ_PASSWORD_HASH_BFF_APP');
    });
});
