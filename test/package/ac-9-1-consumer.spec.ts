// AC-9.1 (UC-1, UC-16), AC-1.1 (условие development), AC-1.2 (уровень C): проекты-потребители на упакованном архиве
// (prd.md §3.8, NFR-3, NFR-4). Нужны Docker (startTestStack) и сеть до реестра npm.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    createConsumerProject,
    removeConsumerProject,
    runInConsumer,
} from './support/consumer-project.js';
import { packTarball, removeTarball, type CommandResult } from './support/pack.js';

let tarball: string | undefined;
let minimal: string | undefined;
let noTestcontainers: string | undefined;

beforeAll(async () => {
    tarball = await packTarball();
    minimal = await createConsumerProject('minimal', tarball);
    noTestcontainers = await createConsumerProject('no-testcontainers', tarball);
});

afterAll(async () => {
    await removeConsumerProject(minimal);
    await removeConsumerProject(noTestcontainers);
    await removeTarball(tarball);
});

function describeResult(result: CommandResult): string {
    return `code ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function dir(path: string | undefined): string {
    if (path === undefined) {
        return expect.fail('проект-потребитель не создан');
    }

    return path;
}

describe('UC-1: проекты-потребители', () => {
    it('AC-9.1: проект-потребитель проходит свои тесты на упакованном архиве (startTestStack, defineEnv, assertRepoConventions)', async () => {
        const result = await runInConsumer(dir(minimal), 'pnpm', ['exec', 'vitest', 'run']);

        expect(result.code, describeResult(result)).toBe(0);
    });

    it('AC-1.1: /testing без условия development — ERR_PACKAGE_PATH_NOT_EXPORTED', async () => {
        const result = await runInConsumer(dir(minimal), 'node', ['import-check.mjs']);

        expect(result.stdout.trim(), describeResult(result)).toBe(
            'config:ok testing:ERR_PACKAGE_PATH_NOT_EXPORTED',
        );
    });

    it('AC-1.1: с условием development — оба подпути', async () => {
        const result = await runInConsumer(dir(minimal), 'node', [
            '--conditions=development',
            'import-check.mjs',
        ]);

        expect(result.stdout.trim(), describeResult(result)).toBe('config:ok testing:ok');
    });

    it('AC-1.1: типы пакета проверяются tsc потребителя', async () => {
        const result = await runInConsumer(dir(minimal), 'pnpm', [
            'exec',
            'tsc',
            '-p',
            'tsconfig.json',
        ]);

        expect(result.code, describeResult(result)).toBe(0);
    });

    it('AC-1.2: без pg и testcontainers /config импортируется, /testing — «@verdeect/kit/testing требует testcontainers — добавьте в зависимости сервиса»', async () => {
        const project = dir(noTestcontainers);
        expect(existsSync(join(project, 'node_modules', 'pg'))).toBe(false);
        expect(existsSync(join(project, 'node_modules', 'testcontainers'))).toBe(false);

        const result = await runInConsumer(project, 'node', [
            '--conditions=development',
            'peer-check.mjs',
        ]);

        expect(result.stdout, describeResult(result)).toContain('config:ok');
        expect(result.stdout, describeResult(result)).toContain(
            'testing:@verdeect/kit/testing требует testcontainers — добавьте в зависимости сервиса',
        );
    });
});
