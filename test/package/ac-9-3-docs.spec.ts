// AC-9.3 (UC-16), NFR-6: документы пакета — API выпущенных подпутей, развёртывание, реестр префиксов id, совместимость,
// CHANGELOG по Keep a Changelog, docs/releasing.md, относительные ссылки. Помощники — verdeect-platform-client docs.spec.ts.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from './support/pack.js';

const ROOT_DOCS = ['README.md', 'CHANGELOG.md', 'AGENTS.md'];
const ENTRY_POINTS = [
    'src/config/index.ts',
    'src/crypto/index.ts',
    'src/database/index.ts',
    'src/http/index.ts',
    'src/idempotency/index.ts',
    'src/messaging/index.ts',
    'src/observability/index.ts',
    'src/testing/index.ts',
];
const PREFIXES = ['evt', 'trn', 'msg', 'lse', 'jup', 'chm', 'chr'];

interface MarkdownFile {
    readonly path: string;
    readonly text: string;
}

/** Текст без fenced-блоков и inline-кода: код в примерах — не ссылка. */
function withoutCode(text: string): string {
    return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function links(text: string): string[] {
    return [...withoutCode(text).matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? '');
}

function isRelative(link: string): boolean {
    return !/^[a-z][a-z0-9+.-]*:/i.test(link) && !link.startsWith('#');
}

/** Раздел Markdown от `## <title>` до следующего `## `. */
function section(text: string, title: string): string {
    const start = text.indexOf(`\n## ${title}\n`);
    if (start === -1) {
        return '';
    }
    const end = text.indexOf('\n## ', start + 1);

    return text.slice(start, end === -1 ? undefined : end);
}

/** Раздел выпуска `## [<version>] - <дата>` или пустая строка, если его ещё нет. */
function releaseSection(text: string, version: string): string {
    const heading = new RegExp(`\\n## \\[${version.replace(/\./g, '\\.')}\\] - `);
    const match = heading.exec(text);
    if (match === null) {
        return '';
    }
    const end = text.indexOf('\n## ', match.index + 1);

    return text.slice(match.index, end === -1 ? undefined : end);
}

/** Имена из `export { … }` и `export type { … }` точки входа; иной вид экспорта — ошибка разбора. */
function exportedNames(source: string, file: string): string[] {
    if (/^export\s+(\*|const|function|class|default|let|interface|type\s+\w+\s*=)/m.test(source)) {
        throw new Error(`${file}: экспорт не через export { … } — обновите разбор`);
    }

    return [...source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)].flatMap((match) =>
        (match[1] ?? '')
            .split(',')
            .map((item) => item.trim().replace(/^type\s+/, ''))
            .filter((item) => item !== '')
            .map((item) => item.split(/\s+as\s+/).at(-1) ?? item),
    );
}

describe('UC-16: документация пакета', () => {
    let files: MarkdownFile[];
    let readme: string;
    let changelog: string;
    let releasing: string;
    let version: string;

    beforeAll(async () => {
        const docs = (await readdir(join(REPO_ROOT, 'docs'), { recursive: true }))
            .filter((path) => path.endsWith('.md'))
            .map((path) => join('docs', path));
        files = await Promise.all(
            [...ROOT_DOCS, ...docs].map(async (path) => ({
                path,
                text: await readFile(join(REPO_ROOT, path), 'utf8'),
            })),
        );
        const text = (path: string): string => files.find((file) => file.path === path)?.text ?? '';
        readme = text('README.md');
        changelog = text('CHANGELOG.md');
        releasing = text(join('docs', 'releasing.md'));
        version = (
            JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
                version: string;
            }
        ).version;
    });

    it('AC-9.3: README — API каждого выпущенного подпути', async () => {
        const api = section(readme, 'API');
        expect(api).not.toBe('');
        const names = (
            await Promise.all(
                ENTRY_POINTS.map(async (file) =>
                    exportedNames(await readFile(join(REPO_ROOT, file), 'utf8'), file),
                ),
            )
        ).flat();
        expect(names.length).toBeGreaterThan(20);

        expect(names.filter((name) => !api.includes(`\`${name}\``))).toEqual([]);
    });

    it('AC-9.3: README — правила развёртывания', () => {
        const deploy = section(readme, 'Развёртывание');

        for (const fragment of [
            'METRICS_PORT',
            'наружу',
            'REPLICA_ID',
            'stop_grace_period: 15s',
            '2 × DB_POOL_MAX × реплики',
            'DLQ',
            '7 дней',
            'ENCRYPTION_KEYS',
            'RABBITMQ_RETRY_SECONDS',
            '.retry',
            'rabbitmq definitions',
            'RABBITMQ_PASSWORD_HASH_',
            'удалить очередь',
            'x-dlq-reason',
            'crypto generate-secret',
            'jq -r .secret',
            'needsReencrypt',
            'первой',
        ]) {
            expect(deploy, fragment).toContain(fragment);
        }
    });

    it('AC-9.3: README — реестр префиксов id', () => {
        const registry = section(readme, 'Реестр префиксов id');
        const rows = registry.split('\n').filter((line) => /^\| `[a-z]+`/.test(line));
        const listed = rows.map((row) => /^\| `([a-z]+)`/.exec(row)?.[1] ?? '');

        for (const prefix of PREFIXES) {
            expect(listed, prefix).toContain(prefix);
        }
        expect(listed.filter((prefix) => !/^[a-z]{2,5}$/.test(prefix))).toEqual([]);
    });

    it('AC-9.3: README — таблица совместимости', () => {
        const compatibility = section(readme, 'Совместимость');
        const header = compatibility.split('\n').find((line) => line.startsWith('|')) ?? '';

        for (const name of [
            '@verdeect/kit',
            '@verdeect/events',
            '@verdeect/auth',
            '@verdeect/platform-client',
        ]) {
            expect(header, name).toContain(name);
        }
        // G14 (PRD v1.8): до перехода Identity выходят только 1.0.0-rc.N после E8.
        expect(compatibility).toMatch(/^\| `1\.0\.0-rc\.N` \(после E8\)/m);
    });

    it('AC-9.3: CHANGELOG — Keep a Changelog, [Unreleased], каждый экспорт в [Unreleased] или разделе version', async () => {
        expect(changelog).toContain('keepachangelog.com');
        expect(changelog).toContain('## [Unreleased]');
        const releases = [
            ...changelog.matchAll(/^## \[(\d+\.\d+\.\d+(?:-rc\.\d+)?)\] - \d{4}-\d{2}-\d{2}$/gm),
        ].map((match) => match[1]);
        const headings = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1]);
        // Других разделов, кроме [Unreleased] и выпусков с датой, нет.
        expect(headings.filter((heading) => heading !== 'Unreleased')).toEqual(releases);

        const pending = [
            section(changelog, '[Unreleased]'),
            releaseSection(changelog, version),
        ].join('\n');
        expect(pending).toContain('### Added');
        const names = (
            await Promise.all(
                ENTRY_POINTS.map(async (file) =>
                    exportedNames(await readFile(join(REPO_ROOT, file), 'utf8'), file),
                ),
            )
        ).flat();
        // Имя в обратных кавычках целиком или с вызовом метода: `KitConfigModule.forRoot({schema})`.
        const mentioned = (name: string): boolean =>
            new RegExp(`\x60${name}[\x60.(]`).test(pending);
        expect(names.filter((name) => !mentioned(name))).toEqual([]);
    });

    it('NFR-6: docs/releasing.md — чек-лист, ручной 1.0.0-rc.1 с меткой next, npm trust, запрет токенов, 1.0.0 после Identity', () => {
        for (const fragment of [
            'pnpm pack:check',
            'git tag v',
            'npm login',
            'npm publish --access public --tag next',
            '1.0.0-rc.1',
            'Identity',
            'v1.0.0',
            'npm trust',
            'disallow tokens',
            'Trusted Publishing',
        ]) {
            expect(releasing, fragment).toContain(fragment);
        }
        expect(releasing).not.toContain('NPM_TOKEN');
    });

    it('AC-9.3: относительные ссылки README, CHANGELOG, AGENTS.md и docs/*.md ведут на существующие файлы', () => {
        const broken = files.flatMap((file) =>
            links(file.text)
                .filter(isRelative)
                .map((link) => link.split('#')[0] ?? '')
                .filter((link) => link !== '')
                .filter((link) => !existsSync(join(REPO_ROOT, dirname(file.path), link)))
                .map((link) => `${file.path}: ${link}`),
        );

        expect(broken).toEqual([]);
    });
});
