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
                message:
                    'RABBITMQ_PASSWORD_HASH_SVC_B: ожидается вывод rabbitmqctl hash_password (base64, ≥ 44 символов)',
                keys: ['RABBITMQ_PASSWORD_HASH_SVC_B'],
            },
        });
        expect(text).not.toContain(HASH_A);
    });

    it('AC-5.10: неверный хеш RABBITMQ_PASSWORD_HASH_<SVC> → выход 1, в stderr имя ключа и hash_password, значения нет', async () => {
        const stderr = vi.mocked(process.stderr.write);
        const { code } = await run(['definitions', '--services', 'svc-a'], {
            RABBITMQ_PASSWORD_HASH_SVC_A: 'plain-password',
        });
        const errors = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

        expect(code).toBe(1);
        expect(errors).toContain('RABBITMQ_PASSWORD_HASH_SVC_A');
        expect(errors).toContain(
            'ожидается вывод rabbitmqctl hash_password (base64, ≥ 44 символов)',
        );
        expect(errors).not.toContain('plain-password');
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

    it('AC-5.10: --admin dev — пользователь dev с тегом administrator, права .* на vhost, topic-права без ограничения, хеш из RABBITMQ_PASSWORD_HASH_DEV; предупреждение в stderr', async () => {
        const stderr = vi.mocked(process.stderr.write);
        stderr.mockClear();
        const { code, json, text } = await run(
            ['definitions', '--services', 'svc-a', '--admin', 'dev'],
            { RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A, RABBITMQ_PASSWORD_HASH_DEV: HASH_B },
        );

        expect(code).toBe(0);
        expect(json['users']).toEqual([
            {
                name: 'svc-a',
                password_hash: HASH_A,
                hashing_algorithm: 'rabbit_password_hashing_sha256',
                tags: [],
            },
            {
                name: 'dev',
                password_hash: HASH_B,
                hashing_algorithm: 'rabbit_password_hashing_sha256',
                tags: ['administrator'],
            },
        ]);
        expect(json['permissions']).toContainEqual({
            user: 'dev',
            vhost: '/',
            configure: '.*',
            write: '.*',
            read: '.*',
        });
        expect(json['topic_permissions']).toContainEqual({
            user: 'dev',
            vhost: '/',
            exchange: 'verdeect.events',
            write: '.*',
            read: '.*',
        });
        const warnings = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(warnings).toContain('"code":"ADMIN_USER"');
        expect(warnings).toContain('только для dev и e2e');
        expect(warnings).not.toContain(HASH_B);
        expect(text).not.toContain('"code":"ADMIN_USER"');
    });

    it('AC-5.10: без --admin администратора в файле нет, stderr пуст', async () => {
        const stderr = vi.mocked(process.stderr.write);
        stderr.mockClear();
        const { code, json } = await run(['definitions', '--services', 'svc-a'], {
            RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A,
        });

        expect(code).toBe(0);
        expect(stderr).not.toHaveBeenCalled();
        expect(
            (json['users'] as { tags: string[] }[]).some((user) =>
                user.tags.includes('administrator'),
            ),
        ).toBe(false);
        expect(JSON.stringify(json['permissions'])).not.toContain('".*"');
    });

    it('AC-5.10: --admin dev без RABBITMQ_PASSWORD_HASH_DEV → INVALID_ENVIRONMENT с именем ключа, без значений, выход 1', async () => {
        const { code, json, text } = await run(
            ['definitions', '--services', 'svc-a', '--admin', 'dev'],
            { RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A },
        );

        expect(code).toBe(1);
        expect(json).toEqual({
            error: {
                code: 'INVALID_ENVIRONMENT',
                message:
                    'RABBITMQ_PASSWORD_HASH_DEV: ожидается вывод rabbitmqctl hash_password (base64, ≥ 44 символов)',
                keys: ['RABBITMQ_PASSWORD_HASH_DEV'],
            },
        });
        expect(text).not.toContain(HASH_A);
    });

    it.each([
        ['имя вне формата', 'Dev_1'],
        ['совпадает с сервисом', 'svc-a'],
    ])('AC-5.10: --admin, %s → USAGE, выход 1', async (_name, admin) => {
        const { code, json } = await run(['definitions', '--services', 'svc-a', '--admin', admin], {
            RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A,
            RABBITMQ_PASSWORD_HASH_DEV_1: HASH_B,
        });

        expect(code).toBe(1);
        expect(json).toMatchObject({ error: { code: 'USAGE' } });
    });

    it('AC-5.10: повторный --publishes одного сервиса — префиксы объединяются без повторов', async () => {
        const { code, json } = await run(
            [
                'definitions',
                '--services',
                'svc-a',
                '--publishes',
                'svc-a=alpha.',
                '--publishes',
                'svc-a=audit.,alpha.',
            ],
            { RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A },
        );
        const single = await (async () => {
            output = [];

            return run(
                ['definitions', '--services', 'svc-a', '--publishes', 'svc-a=alpha.,audit.'],
                {
                    RABBITMQ_PASSWORD_HASH_SVC_A: HASH_A,
                },
            );
        })();

        expect(code, JSON.stringify(json)).toBe(0);
        const [topic] = json['topic_permissions'] as { write: string }[];
        const write = new RegExp(topic?.write ?? '^$');
        expect(['alpha.x', 'audit.x', 'other.x'].map((key) => write.test(key))).toEqual([
            true,
            true,
            false,
        ]);
        expect(json['topic_permissions']).toEqual(single.json['topic_permissions']);
        expect(json['permissions']).toEqual(single.json['permissions']);
    });
});
