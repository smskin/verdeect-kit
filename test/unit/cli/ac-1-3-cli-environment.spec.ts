// AC-1.3 (U, UC-12; prd.md §3.1 v1.35, NFR-4): ошибка окружения любой команды CLI — JSON
// {error: {code: 'INVALID_ENVIRONMENT', message, keys, issues}}, без пути — (root), значений нет в stdout и stderr.
// Одна функция разбора environmentFailure (src/cli/environment.ts) для db, crypto, redis, rabbitmq, openapi.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { z } from 'zod';
import { cryptoCommand } from '../../../src/cli/commands/crypto.js';
import { dbCommand } from '../../../src/cli/commands/db.js';
import { openapiCommand } from '../../../src/cli/commands/openapi.js';
import { rabbitmqCommand } from '../../../src/cli/commands/rabbitmq.js';
import { redisCommand } from '../../../src/cli/commands/redis.js';
import { environmentFailure } from '../../../src/cli/environment.js';
import { defineEnv, parseEnv } from '../../../src/config/index.js';
import { errorOf } from '../config/support.js';

const LOG_LEVEL = 'loud-SECRET_MARKER_CLI';

let cwd: string;
let output: string[];
let stderr: MockInstance<typeof process.stderr.write>;

beforeEach(async () => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cwd = await mkdtemp(join(tmpdir(), 'kit-cli-env-'));
    output = [];
});

afterEach(async () => {
    vi.unstubAllEnvs();
    stderr.mockRestore();
    await rm(cwd, { recursive: true, force: true });
});

type Runner = () => Promise<number>;

function context() {
    return { cwd, write: (text: string) => void output.push(text), env: { LOG_LEVEL } };
}

const commands: readonly (readonly [string, Runner])[] = [
    [
        'openapi',
        () => {
            vi.stubEnv('LOG_LEVEL', LOG_LEVEL);

            return openapiCommand(['--out', join(cwd, 'openapi.json')], {
                cwd,
                write: (text) => void output.push(text),
            });
        },
    ],
    ['db prepare', () => dbCommand(['prepare', '--service', 'svc'], context())],
    [
        'rabbitmq definitions',
        () => rabbitmqCommand(['definitions', '--services', 'svc-a'], context()),
    ],
    [
        'redis acl',
        () => redisCommand(['acl', '--services', 'svc-a', '--out', 'users.acl'], context()),
    ],
    ['crypto generate-secret', () => cryptoCommand(['generate-secret'], context())],
];

/** Схема с superRefine: без пути — ошибка уровня корня, с путём — текст со значением ключа. */
function refinedError(path: readonly string[]) {
    const schema = defineEnv({ DATABASE_URL: z.string() }, (env, ctx) => {
        ctx.addIssue({
            code: 'custom',
            path: [...path],
            message: `плохой адрес ${env.DATABASE_URL}`,
            input: '',
        });
    });

    return errorOf(() => parseEnv(schema, { DATABASE_URL: 'postgres://u:SECRET_MARKER_9@h/db' }));
}

describe('UC-12: ошибка окружения команд CLI', () => {
    it.each(commands)(
        'AC-1.3: ошибка окружения каждой команды CLI — JSON {error: {code: INVALID_ENVIRONMENT, message, keys, issues}}, значения нет в stdout и stderr (%s)',
        async (_name, runCommand) => {
            const code = await runCommand();

            expect(code).toBe(1);
            const text = output.join('');
            const json = JSON.parse(text) as {
                error: { code: string; message: string; keys: string[]; issues: unknown[] };
            };
            expect(json.error).toMatchObject({
                code: 'INVALID_ENVIRONMENT',
                message: 'Неверное окружение',
            });
            expect(json.error.keys).toContain('LOG_LEVEL');
            expect(json.error.issues).toContainEqual({
                key: 'LOG_LEVEL',
                message: expect.stringMatching(/.+/) as unknown,
            });
            const written = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
            expect(written).toContain('INVALID_ENVIRONMENT');
            expect(text).not.toContain('SECRET_MARKER_CLI');
            expect(written).not.toContain('SECRET_MARKER_CLI');
        },
    );

    it('AC-1.3: environmentFailure — ошибка уровня корня → keys [(root)], issues [{key: (root), …}]; не InvalidEnvironmentError — undefined', () => {
        const failure = environmentFailure(refinedError([]));

        expect(failure).toEqual({
            code: 'INVALID_ENVIRONMENT',
            message: 'Неверное окружение',
            keys: ['(root)'],
            issues: [{ key: '(root)', message: 'неверное значение (custom)' }],
        });
        expect(environmentFailure(new Error('x'))).toBeUndefined();
    });

    it('AC-1.3: environmentFailure — текст superRefine со значением ключа → в JSON issues «неверное значение (custom)», значения нет', () => {
        const failure = environmentFailure(refinedError(['DATABASE_URL']));

        expect(failure?.issues).toEqual([
            { key: 'DATABASE_URL', message: 'неверное значение (custom)' },
        ]);
        expect(JSON.stringify(failure)).not.toContain('SECRET_MARKER_9');
    });
});
