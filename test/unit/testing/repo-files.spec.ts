// Разбор файлов репозитория сервиса для assertRepoConventions (prd.md §3.8, AC-1.8).
import { describe, expect, it } from 'vitest';
import {
    expandDefaults,
    imageTags,
    parseEnvFile,
    parseImageRef,
} from '../../../src/testing/repo-files.js';
import { nodeEntry, shellLines, tokenize } from '../../../src/testing/launch-command.js';

describe('AC-1.8: разбор репозитория сервиса', () => {
    it('AC-1.8: tokenize — sh -c с && и кавычками', () => {
        expect(
            tokenize(['sh', '-c', 'pnpm build && node --import "./a b.js" dist/main.js; echo x']),
        ).toEqual([
            ['pnpm', 'build'],
            ['node', '--import', './a b.js', 'dist/main.js'],
            ['echo', 'x'],
        ]);
        expect(tokenize("bash -c 'node dist/main.js || true'")).toEqual([
            ['node', 'dist/main.js'],
            ['true'],
        ]);
        expect(tokenize(['node', 'dist/main.js'])).toEqual([['node', 'dist/main.js']]);
    });

    it('AC-1.8: tokenize — переменные ${VAR} и $VAR остаются в токенах как есть', () => {
        expect(
            tokenize('node --import ${INSTRUMENT:-./dist/instrument.js} $ENTRY "${A}-$B" \'$C\''),
        ).toEqual([
            ['node', '--import', '${INSTRUMENT:-./dist/instrument.js}', '$ENTRY', '${A}-$B', '$C'],
        ]);
    });

    it('AC-1.8: tokenize — |, одиночный &, подоболочка ( ) делят команды; exec остаётся токеном', () => {
        expect(
            tokenize(
                'pnpm build && (tsc --watch & exec node dist/main.js) | tee log; echo "a && b"',
            ),
        ).toEqual([
            ['pnpm', 'build'],
            ['tsc', '--watch'],
            ['exec', 'node', 'dist/main.js'],
            ['tee', 'log'],
            ['echo', 'a && b'],
        ]);
    });

    it('AC-1.8: tokenize — перенаправление 2>&1 не мешает определить файл входа', () => {
        const commands = tokenize(
            'exec node --import ./dist/instrument.js dist/main.js 2>&1 | tee /tmp/log',
        );

        expect(commands).toEqual([
            ['exec', 'node', '--import', './dist/instrument.js', 'dist/main.js'],
            ['tee', '/tmp/log'],
        ]);
        expect(nodeEntry(commands[0] ?? [])).toEqual({
            entry: 'dist/main.js',
            imports: ['./dist/instrument.js'],
        });
    });

    it('AC-1.8: shellLines — перевод строки делит команды, # в начале слова снимается до конца строки, \\ — продолжение', () => {
        expect(
            shellLines(
                '# wait for db\nnode dist/cli.js migrate # миграции\nexec node \\\n  dist/main.js\necho "a # b"',
            ),
        ).toEqual(['node dist/cli.js migrate ', 'exec node   dist/main.js', 'echo "a # b"']);
        expect(shellLines("echo 'x\ny' && node dist/main.js")).toEqual([
            "echo 'x\ny' && node dist/main.js",
        ]);
        expect(shellLines('echo a#b')).toEqual(['echo a#b']);
    });

    it('AC-1.8: tokenize — многострочный скрипт и комментарий: каждая строка — своя команда', () => {
        expect(tokenize(['sh', '-c', 'node dist/cli.js migrate\nexec node dist/main.js'])).toEqual([
            ['node', 'dist/cli.js', 'migrate'],
            ['exec', 'node', 'dist/main.js'],
        ]);
        expect(tokenize(['sh', '-c', '# wait for db\nexec node dist/main.js'])).toEqual([
            ['exec', 'node', 'dist/main.js'],
        ]);
        expect(tokenize(['sh', '-c', 'echo "a # b" && node dist/main.js'])).toEqual([
            ['echo', 'a # b'],
            ['node', 'dist/main.js'],
        ]);
    });

    it.each([
        [['sh', '-ec', 'exec node dist/main.js']],
        [['bash', '-lc', 'exec node dist/main.js']],
        [['sh', '-e', '-c', 'exec node dist/main.js']],
        [['bash', '-o', 'pipefail', '-c', 'exec node dist/main.js']],
        [['/bin/dash', '-c', 'exec node dist/main.js']],
    ])('AC-1.8: tokenize — %j раскрывает скрипт оболочки', (command) => {
        expect(tokenize(command)).toEqual([['exec', 'node', 'dist/main.js']]);
    });

    it('AC-1.8: nodeEntry — --watch-path и другие опции node со значением', () => {
        expect(nodeEntry(['node', '--watch-path', 'src', 'dist/main.js'])?.entry).toBe(
            'dist/main.js',
        );
        expect(
            nodeEntry(['node', '--env-file-if-exists', '.env', '--title', 'svc', 'dist/main.js'])
                ?.entry,
        ).toBe('dist/main.js');
        expect(nodeEntry(['node', '-e', 'process.exit(0)'])).toBeNull();
    });

    it('AC-1.8: parseEnvFile — « #…» у значения без кавычек снимается, в кавычках — нет', () => {
        const env = parseEnvFile('A=20000 # ms\nB="20000 # ms"\nC=a#b\n');

        expect(env.get('A')).toBe('20000');
        expect(env.get('B')).toBe('20000 # ms');
        expect(env.get('C')).toBe('a#b');
    });

    it('AC-1.8: imageTags — префикс docker.io/library/ и docker.io/ в CI снимается', () => {
        expect(imageTags('image: docker.io/library/postgres:16.15-alpine3.24', 'postgres')).toEqual(
            ['16.15-alpine3.24'],
        );
        expect(imageTags('- docker.io/axllent/mailpit:v1.31.6', 'axllent/mailpit')).toEqual([
            'v1.31.6',
        ]);
    });

    it('AC-1.8: nodeEntry — опции со значением и без', () => {
        expect(nodeEntry(['node', '--import=./i.js', '--watch', 'dist/main.js'])).toEqual({
            entry: 'dist/main.js',
            imports: ['./i.js'],
        });
        expect(nodeEntry(['node', '--inspect=0.0.0.0:9229', '-r', 'x', 'main.ts'])).toEqual({
            entry: 'main.ts',
            imports: [],
        });
        expect(nodeEntry(['/usr/bin/node', '--import', './i.js', 'main.js'])?.imports).toEqual([
            './i.js',
        ]);
        expect(nodeEntry(['node', '--import', 'x', 'test/fake-services.main.ts'])?.entry).toBe(
            'test/fake-services.main.ts',
        );
        expect(nodeEntry(['pnpm', 'build'])).toBeNull();
    });

    it('AC-1.8: env-файл — кавычки, export, комментарии', () => {
        const env = parseEnvFile('# комментарий\n\nexport A=1\nB="два слова"\nC=\'x\'\nD\n');

        expect([...env]).toEqual([
            ['A', '1'],
            ['B', 'два слова'],
            ['C', 'x'],
        ]);
    });

    it('AC-1.8: образы в тексте — postgres:5432 не образ', () => {
        const text =
            'image: postgres:17.11-alpine3.24\nurl: postgres://u:p@postgres:5432/db\nx postgres:5432';

        expect(imageTags(text, 'postgres')).toEqual(['17.11-alpine3.24']);
        expect(imageTags('image: bitnami/postgres:16.1', 'postgres')).toEqual([]);
        expect(imageTags('- axllent/mailpit:v1.31.6', 'axllent/mailpit')).toEqual(['v1.31.6']);
    });

    it('AC-1.8: parseImageRef — значение image: compose', () => {
        expect(parseImageRef('postgres')).toEqual({
            repository: 'postgres',
            tag: 'latest',
            tagUnresolved: false,
        });
        expect(parseImageRef('docker.io/axllent/mailpit:v1.31.6')).toMatchObject({
            repository: 'axllent/mailpit',
            tag: 'v1.31.6',
        });
        expect(parseImageRef('registry.local:5000/svc/app')).toMatchObject({
            repository: 'registry.local:5000/svc/app',
            tag: 'latest',
        });
        expect(parseImageRef('postgres:17.11-alpine3.24@sha256:abc')).toMatchObject({
            repository: 'postgres',
            tag: '17.11-alpine3.24',
        });
        expect(parseImageRef('${PG_IMAGE:-postgres:16}')).toMatchObject({
            repository: 'postgres',
            tag: '16',
        });
        expect(parseImageRef('postgres:${PG_TAG}')).toMatchObject({
            repository: 'postgres',
            tagUnresolved: true,
        });
        expect(parseImageRef('${APP_IMAGE}').repository).toBeNull();
    });

    it('AC-1.8: expandDefaults', () => {
        expect(expandDefaults('${X:-a:b}')).toBe('a:b');
        expect(expandDefaults('${X-a}')).toBe('a');
        expect(expandDefaults('${X}')).toBe('${X}');
    });
});
