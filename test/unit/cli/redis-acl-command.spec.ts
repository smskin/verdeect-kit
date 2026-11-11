// UC-12, AC-8.1 (U; PRD v1.18): команда verdeect-kit redis acl —
// aclfile с user default off и пользователями сервисов, --out обязателен,
// USAGE, INVALID_ENVIRONMENT без значений (prd.md §3.7; D3 плана E8; ARCHITECTURE.md «CLI»). Обработчик вызывается в
// процессе; образец — ac-5-10-rabbitmq-command.spec.ts.
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { redisCommand } from '../../../src/cli/commands/redis.js';
import { redisPasswordHash } from '../../../src/internal/redis-acl.js';

const HASH_A = redisPasswordHash('a');
const HASH_B = redisPasswordHash('b');

let cwd: string;
let output: string[];
let stderr: MockInstance<typeof process.stderr.write>;

async function run(
    args: string[],
    env: Record<string, string> = {},
): Promise<{ code: number; text: string; json: Record<string, unknown> }> {
    const code = await redisCommand(args, {
        cwd,
        write: (text) => void output.push(text),
        env: { LOG_LEVEL: 'silent', ...env },
    });
    const text = output.join('');

    return { code, text, json: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(async () => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cwd = await mkdtemp(join(tmpdir(), 'kit-redis-'));
    output = [];
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true });
});

describe('UC-12: verdeect-kit redis acl', () => {
    it('AC-8.1: redis acl --services svc-a,bff-app --out f — user default off первой строкой, #<хеш> без открытого пароля, по строке на сервис, stdout {out, services}, выход 0', async () => {
        const { code, json } = await run(
            ['acl', '--services', 'svc-a, bff-app', '--out', 'acl/users.acl'],
            {
                REDIS_PASSWORD_HASH_SVC_A: HASH_A,
                REDIS_PASSWORD_HASH_BFF_APP: HASH_B,
            },
        );
        const out = join(cwd, 'acl/users.acl');

        expect(code).toBe(0);
        expect(json).toEqual({ out, services: ['svc-a', 'bff-app'] });
        expect(await readFile(out, 'utf8')).toBe(
            [
                'user default off',
                `user svc-a on #${HASH_A} ~svc-a:* &svc-a:* +@all -@dangerous`,
                `user bff-app on #${HASH_B} ~bff-app:* &bff-app:* +@all -@dangerous`,
                '',
            ].join('\n'),
        );
    });

    it.each([
        ['ключа нет', {}],
        ['хеш не 64 hex', { REDIS_PASSWORD_HASH_BFF_APP: HASH_B.toUpperCase() }],
    ])(
        'AC-8.1: %s у REDIS_PASSWORD_HASH_BFF_APP — INVALID_ENVIRONMENT, keys без значений, выход 1, файла нет',
        async (_name, env) => {
            const { code, json, text } = await run(
                ['acl', '--services', 'svc-a,bff-app', '--out', 'users.acl'],
                { REDIS_PASSWORD_HASH_SVC_A: HASH_A, ...env },
            );

            expect(code).toBe(1);
            expect(json).toEqual({
                error: {
                    code: 'INVALID_ENVIRONMENT',
                    message: 'Неверное окружение',
                    keys: ['REDIS_PASSWORD_HASH_BFF_APP'],
                },
            });
            expect(text).not.toContain(HASH_A);
            expect(existsSync(join(cwd, 'users.acl'))).toBe(false);
        },
    );

    it.each([
        ['без подкоманды', []],
        ['подкоманда users', ['users']],
        ['без --services', ['acl', '--out', 'f']],
        ['без --out', ['acl', '--services', 'svc-a']],
        ['неизвестная опция', ['acl', '--services', 'svc-a', '--out', 'f', '--db', '1']],
        ['имя Bad_Svc', ['acl', '--services', 'Bad_Svc', '--out', 'f']],
        ['имя дважды', ['acl', '--services', 'svc-a,svc-a', '--out', 'f']],
    ])('UC-12: %s → USAGE, выход 1', async (_name, args) => {
        const { code, json } = await run(args, { REDIS_PASSWORD_HASH_SVC_A: HASH_A });

        expect(code).toBe(1);
        expect(json).toMatchObject({ error: { code: 'USAGE' } });
    });

    it('UC-12: хеши не попадают в stderr-лог', async () => {
        await run(['acl', '--services', 'svc-a,bff-app', '--out', 'users.acl'], {
            LOG_LEVEL: 'debug',
            REDIS_PASSWORD_HASH_SVC_A: HASH_A,
            REDIS_PASSWORD_HASH_BFF_APP: 'bad',
        });
        output = [];
        await run(['acl', '--services', 'svc-a', '--out', 'users.acl'], {
            REDIS_PASSWORD_HASH_SVC_A: HASH_A,
        });

        const written = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(written).toContain('INVALID_ENVIRONMENT');
        expect(written).not.toContain(HASH_A);
        expect(written).not.toContain('bad"');
    });
});
