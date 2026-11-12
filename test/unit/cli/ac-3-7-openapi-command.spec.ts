// AC-3.7 (UC-14): команда verdeect-kit openapi — запись документа, JSON-результат и JSON-ошибки с кодом 1 (prd.md §3.5;
// ARCHITECTURE.md «CLI»). Обработчик вызывается в процессе: проверяются код выхода и строка stdout; process.exit CLI не
// вызывает.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openapiCommand } from '../../../src/cli/commands/openapi.js';
// Фикстура загружается при импорте файла (как до KT-62): иначе холодная загрузка .ts — в первом тесте и под нагрузкой
// превышает testTimeout. CLI получает её из кэша модулей.
import '../../fixtures/http/api-app.module.js';

const FIXTURES = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../fixtures/http');
const FIXTURE = join(FIXTURES, 'api-app.module.ts');
/** Эталон документа фикстуры: правится вручную вместе с фикстурой, не генерируется тестом. */
const GOLDEN = join(FIXTURES, 'api-app.openapi.json');

let cwd: string;
let lines: string[];

async function run(args: string[]): Promise<{ code: number; output: Record<string, unknown> }> {
    const code = await openapiCommand(args, { cwd, write: (line) => void lines.push(line) });

    return { code, output: JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown> };
}

beforeEach(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cwd = await mkdtemp(join(tmpdir(), 'kit-openapi-'));
    lines = [];
    await writeFile(
        join(cwd, 'package.json'),
        JSON.stringify({ name: 'api-app', version: '1.2.3' }),
    );
});

afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(cwd, { recursive: true, force: true });
});

describe('UC-14: CLI openapi', () => {
    it('AC-3.7: CLI openapi --out <tmp> --module <fixture>#ApiAppModule пишет документ, равный эталону, stdout {written, operations}', async () => {
        const { code, output } = await run([
            '--out',
            'contracts/openapi.json',
            '--module',
            `${FIXTURE}#ApiAppModule`,
        ]);
        const written = await readFile(join(cwd, 'contracts/openapi.json'), 'utf8');

        expect(code).toBe(0);
        expect(output).toEqual({ written: 'contracts/openapi.json', operations: 10 });
        expect(written).toBe(await readFile(GOLDEN, 'utf8'));
    });

    it('AC-3.7: contracts/openapi.extra.json сливается с документом', async () => {
        await run(['--out', 'contracts/openapi.json', '--module', `${FIXTURE}#ApiAppModule`]);
        await writeFile(
            join(cwd, 'contracts/openapi.extra.json'),
            JSON.stringify({
                paths: {
                    '/events': {
                        get: { summary: 'SSE', responses: { 200: { description: 'поток' } } },
                    },
                },
            }),
        );
        await run(['--out', 'contracts/openapi.json', '--module', `${FIXTURE}#ApiAppModule`]);
        const written = JSON.parse(await readFile(join(cwd, 'contracts/openapi.json'), 'utf8')) as {
            paths: Record<string, unknown>;
        };

        expect(Object.keys(written.paths)).toEqual([
            '/catalog/count',
            '/catalog/list',
            '/items',
            '/items/{id}',
            '/public/info',
            '/public/limited',
            '/public/notes',
            '/public/search',
            '/tenant/settings',
            '/events',
        ]);
    });

    it("AC-3.7: --module с несуществующим файлом → JSON {error: {code: 'MODULE_NOT_FOUND'}} в stdout, выход 1", async () => {
        const { code, output } = await run([
            '--out',
            'o.json',
            '--module',
            'dist/nope.js#AppModule',
        ]);

        expect(code).toBe(1);
        expect(output).toMatchObject({ error: { code: 'MODULE_NOT_FOUND' } });
    });

    it("AC-3.7: cwd с package.json без version → JSON {error: {code: 'INVALID_PACKAGE_JSON'}}, выход 1", async () => {
        await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'api-app' }));
        const { code, output } = await run([
            '--out',
            'o.json',
            '--module',
            `${FIXTURE}#ApiAppModule`,
        ]);

        expect(code).toBe(1);
        expect(output).toMatchObject({ error: { code: 'INVALID_PACKAGE_JSON' } });
    });

    it('AC-3.7: --module <fixture>#NoSuchExport → JSON {error}, выход 1', async () => {
        const { code, output } = await run([
            '--out',
            'o.json',
            '--module',
            `${FIXTURE}#NoSuchExport`,
        ]);

        expect(code).toBe(1);
        expect(output).toMatchObject({ error: { code: 'MODULE_NOT_FOUND' } });
    });

    it("AC-3.7: без --out и с неизвестной опцией → JSON {error: {code: 'USAGE'}}, выход 1", async () => {
        const missing = await run(['--module', `${FIXTURE}#ApiAppModule`]);
        const unknown = await run(['--out', 'o.json', '--bogus']);

        expect(missing.code).toBe(1);
        expect(missing.output).toMatchObject({ error: { code: 'USAGE' } });
        expect(unknown.code).toBe(1);
        expect(unknown.output).toMatchObject({ error: { code: 'USAGE' } });
    });

    it("AC-3.7: openapi.extra.json не объект или не JSON → JSON {error: {code: 'INVALID_EXTRA'}}, выход 1", async () => {
        await mkdir(join(cwd, 'contracts'), { recursive: true });
        for (const text of ['[1]', '{не json']) {
            await writeFile(join(cwd, 'contracts/openapi.extra.json'), text);
            const { code, output } = await run([
                '--out',
                'contracts/openapi.json',
                '--module',
                `${FIXTURE}#ApiAppModule`,
            ]);

            expect(code).toBe(1);
            expect(output).toMatchObject({ error: { code: 'INVALID_EXTRA' } });
        }
    });
});
