// AC-7.5, UC-10 шаг 1 (U): команда verdeect-kit crypto generate-secret [--bytes N] — stdout одна строка {"secret"},
// USAGE на неверные аргументы, секрет не попадает в лог (prd.md §3.6; ARCHITECTURE.md «CLI»). Обработчик — в процессе.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cryptoCommand } from '../../../src/cli/commands/crypto.js';
import { defineEnv, envCrypto, parseEnv } from '../../../src/config/index.js';

let output: string[];
let stderr: { mock: { calls: unknown[][] } };

async function run(
    args: string[],
    env: Record<string, string> = {},
): Promise<{ code: number; text: string; json: Record<string, unknown> }> {
    const code = await cryptoCommand(args, {
        write: (text) => void output.push(text),
        env: { LOG_LEVEL: 'silent', ...env },
    });
    const text = output.join('');

    return { code, text, json: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    output = [];
});

describe('UC-10: verdeect-kit crypto generate-secret', () => {
    it('AC-7.5: crypto generate-secret — stdout одна строка JSON {secret}, значение secret принимается ENCRYPTION_KEYS, выход 0', async () => {
        const { code, text, json } = await run(['generate-secret']);
        const secret = String(json['secret']);

        expect(code).toBe(0);
        expect(text.split('\n')).toEqual([expect.any(String), '']);
        expect(Object.keys(json)).toEqual(['secret']);
        expect(secret).not.toContain('=');
        expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
        const env = parseEnv(defineEnv({ ...envCrypto }), {
            ENCRYPTION_KEYS: JSON.stringify([{ version: 1, secret }]),
        });
        expect(env.ENCRYPTION_KEYS).toEqual([{ version: 1, secret }]);
    });

    it('AC-7.5: --bytes 16 → USAGE, выход 1', async () => {
        const { code, json } = await run(['generate-secret', '--bytes', '16']);

        expect(code).toBe(1);
        expect(json).toMatchObject({ error: { code: 'USAGE' } });
    });

    it('AC-7.5: --bytes 64 — секрет 64 байта', async () => {
        const { code, json } = await run(['generate-secret', '--bytes', '64']);

        expect(code).toBe(0);
        expect(Buffer.from(String(json['secret']), 'base64url')).toHaveLength(64);
    });

    it('UC-10: два вызова — разные секреты', async () => {
        const first = (await run(['generate-secret'])).json['secret'];
        output = [];
        const second = (await run(['generate-secret'])).json['secret'];

        expect(first).not.toBe(second);
    });

    it.each([
        ['без подкоманды', []],
        ['generate', ['generate']],
        ['лишний позиционный аргумент', ['generate-secret', '64']],
        ['--bytes 0', ['generate-secret', '--bytes', '0']],
        ['--bytes abc', ['generate-secret', '--bytes', 'abc']],
        ['неизвестная опция --out x', ['generate-secret', '--out', 'x']],
    ])('UC-10: %s → USAGE, выход 1', async (_name, args) => {
        const { code, json } = await run(args);

        expect(code).toBe(1);
        expect(json).toMatchObject({ error: { code: 'USAGE' } });
    });

    it('AC-7.5: при LOG_LEVEL=debug stdout — только одна строка JSON, debug-лог «crypto generate-secret: 32 байт» — в stderr, секрета в stderr нет', async () => {
        const { code, text, json } = await run(['generate-secret'], { LOG_LEVEL: 'debug' });
        const logged = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

        expect(code).toBe(0);
        expect(text.split('\n')).toEqual([JSON.stringify(json), '']);
        expect(Object.keys(json)).toEqual(['secret']);
        expect(logged).toContain('crypto generate-secret: 32 байт');
        expect(logged).not.toContain(String(json['secret']));
    });
});
