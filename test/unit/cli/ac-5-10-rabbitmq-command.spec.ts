// UC-12, AC-5.10 (U): команда verdeect-kit rabbitmq definitions — JSON definitions, --out, USAGE, INVALID_ENVIRONMENT
// без значений (prd.md §3.4; ARCHITECTURE.md «CLI»). Обработчик вызывается в процессе.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rabbitmqCommand } from '../../../src/cli/commands/rabbitmq.js';
import { hashRabbitPassword } from '../../../src/internal/rabbitmq-definitions.js';

const HASH_A = hashRabbitPassword('a');
const HASH_B = hashRabbitPassword('b');

let cwd: string;
let output: string[];

async function run(
    args: string[],
    env: Record<string, string> = {},
): Promise<{ code: number; text: string; json: Record<string, unknown> }> {
    const code = await rabbitmqCommand(args, {
        cwd,
        write: (text) => void output.push(text),
        env: { LOG_LEVEL: 'silent', ...env },
    });
    const text = output.join('');

    return { code, text, json: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cwd = await mkdtemp(join(tmpdir(), 'kit-rabbitmq-'));
    output = [];
});

afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
});

describe('UC-12: verdeect-kit rabbitmq definitions', () => {
    it('UC-12: rabbitmq definitions --services svc-a,svc-b — JSON с двумя пользователями', async () => {
        const { code, json } = await run(['definitions', '--services', 'svc-a, svc-b'], {
            RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A,
            RABBITMQ_PASSWORD_HASH_SVC_B: HASH_B,
        });

        expect(code).toBe(0);
        expect(
            (json['users'] as { name: string; password_hash: string }[]).map((user) => user.name),
        ).toEqual(['svc-a', 'svc-b']);
        expect(json['exchanges']).toHaveLength(1);
    });

    it.each([
        ['без --services', ['definitions']],
        ['неизвестная подкоманда', ['queues']],
        ['имя Bad_Name', ['definitions', '--services', 'Bad_Name']],
        ['неизвестная опция', ['definitions', '--services', 'svc-a', '--vhost', 'x']],
    ])('UC-12: %s → USAGE, выход 1', async (_name, args) => {
        const { code, json } = await run(args, { RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A });

        expect(code).toBe(1);
        expect(json).toMatchObject({ error: { code: 'USAGE' } });
    });

    it('AC-5.10: нет RABBITMQ_PASSWORD_HASH_SVC_B одного из --services → INVALID_ENVIRONMENT с именем ключа, значений в выводе нет, выход 1', async () => {
        const { code, json, text } = await run(['definitions', '--services', 'svc-a,svc-b'], {
            RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A,
        });

        expect(code).toBe(1);
        expect(json).toEqual({
            error: {
                code: 'INVALID_ENVIRONMENT',
                message: 'Неверное окружение',
                keys: ['RABBITMQ_PASSWORD_HASH_SVC_B'],
            },
        });
        expect(text).not.toContain(HASH_A);
    });

    it('UC-12: хеш неверного формата → INVALID_ENVIRONMENT с этим ключом, без значения', async () => {
        const { code, json, text } = await run(['definitions', '--services', 'svc-a'], {
            RABBITMQ_PASSWORD_HASH_SVC_A: 'plain-password',
        });

        expect(code).toBe(1);
        expect(json).toMatchObject({ error: { keys: ['RABBITMQ_PASSWORD_HASH_SVC_A'] } });
        expect(text).not.toContain('plain-password');
    });

    it('UC-12: --out пишет файл и печатает {out, services}', async () => {
        const { code, json } = await run(
            ['definitions', '--services', 'svc-a', '--out', 'deploy/defs.json'],
            {
                RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A,
            },
        );

        expect(code).toBe(0);
        expect(json).toEqual({ out: join(cwd, 'deploy/defs.json'), services: ['svc-a'] });
        const file = JSON.parse(await readFile(join(cwd, 'deploy/defs.json'), 'utf8')) as {
            users: { password_hash: string }[];
        };
        expect(file.users[0]?.password_hash).toBe(HASH_A);
    });

    it.each([
        ['неверный префикс (без точки)', ['--publishes', 'svc-a=svc-a']],
        ['неверный префикс (заглавные)', ['--publishes', 'svc-a=Svc.']],
        ['пустой префикс', ['--publishes', 'svc-a=']],
        ['сервис вне --services', ['--publishes', 'other=other.']],
        ['без <svc>=', ['--publishes', 'svc-a.']],
    ])(
        'AC-5.10: --publishes, %s → USAGE, выход 1, без значений окружения',
        async (_name, extra) => {
            const { code, json, text } = await run(
                ['definitions', '--services', 'svc-a', ...extra],
                {
                    RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A,
                },
            );

            expect(code).toBe(1);
            expect(json).toMatchObject({ error: { code: 'USAGE' } });
            expect(text).not.toContain(HASH_A);
        },
    );

    it('AC-5.10: снимок definitions — identity=identity., orchestrator=agent.,audit.agent., bff-app без --publishes', async () => {
        const { code, json } = await run(
            [
                'definitions',
                '--services',
                'identity,orchestrator,bff-app',
                '--publishes',
                'identity=identity.',
                '--publishes',
                'orchestrator=agent.,audit.agent.',
            ],
            {
                RABBITMQ_PASSWORD_HASH_IDENTITY: HASH_A,
                RABBITMQ_PASSWORD_HASH_ORCHESTRATOR: HASH_A,
                RABBITMQ_PASSWORD_HASH_BFF_APP: HASH_A,
            },
        );

        expect(code).toBe(0);
        expect({
            permissions: json['permissions'],
            topic_permissions: json['topic_permissions'],
        }).toEqual({
            permissions: [
                {
                    user: 'identity',
                    vhost: '/',
                    configure: '^identity(\\..*)?$',
                    write: '^(verdeect\\.events|amq\\.default|identity(\\..*)?)$',
                    read: '^(verdeect\\.events|identity(\\..*)?)$',
                },
                {
                    user: 'orchestrator',
                    vhost: '/',
                    configure: '^orchestrator(\\..*)?$',
                    write: '^(verdeect\\.events|amq\\.default|orchestrator(\\..*)?)$',
                    read: '^(verdeect\\.events|orchestrator(\\..*)?)$',
                },
                {
                    user: 'bff-app',
                    vhost: '/',
                    configure: '^bff\\-app(\\..*)?$',
                    write: '^(amq\\.default|bff\\-app(\\..*)?)$',
                    read: '^(verdeect\\.events|bff\\-app(\\..*)?)$',
                },
            ],
            topic_permissions: [
                {
                    user: 'identity',
                    vhost: '/',
                    exchange: 'verdeect.events',
                    write: '^(identity\\.)',
                    read: '.*',
                },
                {
                    user: 'orchestrator',
                    vhost: '/',
                    exchange: 'verdeect.events',
                    write: '^(agent\\.|audit\\.agent\\.)',
                    read: '.*',
                },
                {
                    user: 'bff-app',
                    vhost: '/',
                    exchange: 'verdeect.events',
                    write: '^$',
                    read: '.*',
                },
            ],
        });
    });
});
