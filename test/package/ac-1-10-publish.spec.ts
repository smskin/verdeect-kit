// AC-1.10 (часть, UC-16): сухой прогон scripts/publish.mjs против локального реестра на node:http — без сети и без
// публикации (prd.md G14, NFR-6, G13). Образец — verdeect-platform-client test/package/release.spec.ts, случаи 1–4;
// метки npm: v<x.y.z>-rc.<N> → next, без суффикса → latest, другой суффикс — отказ. Проверки workflow — этап 5.1a.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, runCommand, type CommandResult } from './support/pack.js';

type RegistryMode = 'missing' | 'published';

const PUBLISH_LINE = '[publish] npm publish';

function describeResult(result: CommandResult): string {
    return `code ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

describe('UC-16: выпуск версии', () => {
    let version: string;
    let packageName: string;
    let registry: Server;
    let registryUrl: string;
    let mode: RegistryMode = 'missing';
    let configDir: string;
    /** Копия скрипта рядом с манифестом версии без суффикса — для метки latest. */
    let releaseRoot: string;

    beforeAll(async () => {
        const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
            name: string;
            version: string;
        };
        version = manifest.version;
        packageName = manifest.name;

        registry = createServer((request, response) => {
            console.info(`[package-check] registry ${mode} ${request.method} ${request.url}`);
            response.setHeader('content-type', 'application/json');
            if (mode === 'missing') {
                response.statusCode = 404;
                response.end(JSON.stringify({ error: 'Not found' }));

                return;
            }
            response.end(
                JSON.stringify({
                    name: packageName,
                    'dist-tags': { latest: version },
                    versions: { [version]: { name: packageName, version } },
                }),
            );
        });
        await new Promise<void>((resolve) => registry.listen(0, '127.0.0.1', resolve));
        registryUrl = `http://127.0.0.1:${(registry.address() as AddressInfo).port}/`;

        // Пустой пользовательский конфиг npm: реестр и токены из ~/.npmrc не перебьют локальный реестр.
        configDir = await mkdtemp(join(tmpdir(), 'verdeect-kit-npmrc-'));
        await writeFile(join(configDir, '.npmrc'), '');

        releaseRoot = await mkdtemp(join(tmpdir(), 'verdeect-kit-release-'));
        await mkdir(join(releaseRoot, 'scripts'));
        await cp(
            join(REPO_ROOT, 'scripts', 'publish.mjs'),
            join(releaseRoot, 'scripts', 'publish.mjs'),
        );
        await writeFile(
            join(releaseRoot, 'package.json'),
            `${JSON.stringify({ name: packageName, version: '1.0.0' }, null, 2)}\n`,
        );
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => registry.close(() => resolve()));
        await rm(configDir, { recursive: true, force: true });
        await rm(releaseRoot, { recursive: true, force: true });
    });

    async function dryRun(
        tag: string,
        registryMode: RegistryMode,
        root: string = REPO_ROOT,
    ): Promise<CommandResult> {
        mode = registryMode;

        return runCommand('node', ['scripts/publish.mjs', '--dry-run'], root, {
            GITHUB_REF_NAME: tag,
            npm_config_registry: registryUrl,
            npm_config_userconfig: join(configDir, '.npmrc'),
            // Как в CI: токенов нет, только OIDC (NFR-6).
            NODE_AUTH_TOKEN: '',
        });
    }

    it('AC-1.10: тег = version, версии нет в npm → npm publish --dry-run, авторизация OIDC', async () => {
        const result = await dryRun(`v${version}`, 'missing');

        expect(result.code, describeResult(result)).toBe(0);
        expect(result.stdout).toContain('авторизация: OIDC (Trusted Publishing)');
        expect(result.stdout).toContain(`${PUBLISH_LINE} --access public`);
        expect(result.stdout).toContain('--dry-run');
    });

    it('AC-1.10: тег v<x.y.z>-rc.<N> → npm publish --tag next', async () => {
        expect(version).toMatch(/-rc\.\d+$/);

        const result = await dryRun(`v${version}`, 'missing');

        expect(result.code, describeResult(result)).toBe(0);
        expect(result.stdout).toContain(`${PUBLISH_LINE} --access public --tag next --dry-run`);
    });

    it('AC-1.10: тег без суффикса → npm publish --tag latest', async () => {
        const result = await dryRun('v1.0.0', 'missing', releaseRoot);

        expect(result.code, describeResult(result)).toBe(0);
        expect(result.stdout).toContain(`${PUBLISH_LINE} --access public --tag latest --dry-run`);
    });

    it('AC-1.10: другой суффикс → выход 1 до публикации', async () => {
        for (const tag of ['v1.0.0-beta.1', 'v1.0.0-rc', 'v1.0.0-rc.0', 'v1.0.0-rc.1.1']) {
            const result = await dryRun(tag, 'missing');

            expect(result.code, `${tag}\n${describeResult(result)}`).toBe(1);
            expect(result.stderr).toContain('суффикс не поддерживается');
            expect(result.stdout).not.toContain(PUBLISH_LINE);
        }
    });

    it('AC-1.10: тег ≠ version → выход 1 до публикации («не совпадает»)', async () => {
        const result = await dryRun('v9.9.9', 'missing');

        expect(result.code, describeResult(result)).toBe(1);
        expect(result.stderr).toContain('не совпадает');
        expect(result.stdout).not.toContain(PUBLISH_LINE);
    });

    it('AC-1.10: версия уже есть в npm → выход 1 («уже опубликована»)', async () => {
        const result = await dryRun(`v${version}`, 'published');

        expect(result.code, describeResult(result)).toBe(1);
        expect(result.stderr).toContain('уже опубликована');
        expect(result.stdout).not.toContain(PUBLISH_LINE);
    });

    it('AC-1.10: тег не vX.Y.Z → выход 1', async () => {
        for (const tag of ['1.0.0', 'v1.0', 'release']) {
            const result = await dryRun(tag, 'missing');

            expect(result.code, `${tag}\n${describeResult(result)}`).toBe(1);
            expect(result.stderr).toContain('не соответствует шаблону');
            expect(result.stdout).not.toContain(PUBLISH_LINE);
        }
    });
});
