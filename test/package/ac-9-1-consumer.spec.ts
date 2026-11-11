// AC-9.1 (UC-1, UC-16; E4 — БД и идемпотентность, drizzle-kit; E5 — сообщения), AC-1.1 (условие development), AC-1.2
// (уровень C), AC-3.8, AC-5.13 (покрытие outbox), AC-5.18 (vhost воркера)
// (снимок OpenAPI): проекты-потребители на упакованном архиве (prd.md §3.5, §3.8, NFR-3, NFR-4). Нужны Docker (startTestStack) и сеть до реестра npm.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
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
    let mainRun: CommandResult | undefined;

    it('AC-9.1: проект-потребитель проходит свои тесты на упакованном архиве (startTestStack, defineEnv, assertRepoConventions, /health, /metrics, остановка, сообщения) с KIT_OUTBOX_COVERAGE=1', async () => {
        const result = await runInConsumer(dir(minimal), 'pnpm', ['exec', 'vitest', 'run'], {
            KIT_OUTBOX_COVERAGE: '1',
        });
        mainRun = result;

        expect(result.code, describeResult(result)).toBe(0);
    });

    it('AC-5.18: после прогона потребителя vhost и пользователи с префиксом consumer-test- удалены', () => {
        const output = `${mainRun?.stdout ?? ''}${mainRun?.stderr ?? ''}`;
        const match = /\[startTestStack\] RabbitMQ: удалено vhost (\d+), пользователей (\d+)/.exec(
            output,
        );

        expect(match, output.slice(-2000)).not.toBeNull();
        expect(Number(match?.[1])).toBeGreaterThanOrEqual(1);
        expect(Number(match?.[2])).toBeGreaterThanOrEqual(1);
    });

    it('AC-5.13: при KIT_OUTBOX_COVERAGE=1 событие без успешного expectOutbox роняет teardown со списком типов', async () => {
        const result = await runInConsumer(
            dir(minimal),
            'pnpm',
            ['exec', 'vitest', 'run', '-c', 'outbox-coverage/vitest.config.ts'],
            { KIT_OUTBOX_COVERAGE: '1' },
        );
        const output = result.stdout + result.stderr;
        const line = output
            .split('\n')
            .find((item) => item.includes('assertOutboxCoverage: события'));

        expect(result.code, describeResult(result)).not.toBe(0);
        expect(line, describeResult(result)).toContain('consumer.company.archived.v1');
        expect(line).not.toContain('consumer.company.created.v1');
    });

    it('AC-5.13: без KIT_OUTBOX_COVERAGE тот же прогон не падает', async () => {
        const result = await runInConsumer(
            dir(minimal),
            'pnpm',
            ['exec', 'vitest', 'run', '-c', 'outbox-coverage/vitest.config.ts'],
            { KIT_OUTBOX_COVERAGE: '' },
        );

        expect(result.code, describeResult(result)).toBe(0);
    });

    it('AC-1.1: /testing без условия development — ERR_PACKAGE_PATH_NOT_EXPORTED', async () => {
        const result = await runInConsumer(dir(minimal), 'node', ['import-check.mjs']);

        expect(result.stdout.trim(), describeResult(result)).toBe(
            'config:ok database:ok http:ok idempotency:ok messaging:ok observability:ok testing:ERR_PACKAGE_PATH_NOT_EXPORTED',
        );
    });

    it('AC-1.1: с условием development — все подпути', async () => {
        const result = await runInConsumer(dir(minimal), 'node', [
            '--conditions=development',
            'import-check.mjs',
        ]);

        expect(result.stdout.trim(), describeResult(result)).toBe(
            'config:ok database:ok http:ok idempotency:ok messaging:ok observability:ok testing:ok',
        );
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

    it('AC-1.2: без pg и testcontainers /config, /http, /messaging, /observability импортируются; /database — «@verdeect/kit/database требует pg — добавьте в зависимости сервиса»; /idempotency — «@verdeect/kit/idempotency требует pg — …»; /testing — «… требует testcontainers …»', async () => {
        const project = dir(noTestcontainers);
        expect(existsSync(join(project, 'node_modules', 'pg'))).toBe(false);
        expect(existsSync(join(project, 'node_modules', 'testcontainers'))).toBe(false);

        const result = await runInConsumer(project, 'node', [
            '--conditions=development',
            'peer-check.mjs',
        ]);

        expect(result.stdout, describeResult(result)).toContain('config:ok');
        expect(result.stdout, describeResult(result)).toContain('http:ok');
        expect(result.stdout, describeResult(result)).toContain('observability:ok');
        expect(result.stdout, describeResult(result)).toContain(
            'database:@verdeect/kit/database требует pg — добавьте в зависимости сервиса',
        );
        expect(result.stdout, describeResult(result)).toContain(
            'idempotency:@verdeect/kit/idempotency требует pg — добавьте в зависимости сервиса',
        );
        expect(result.stdout, describeResult(result)).toContain(
            'testing:@verdeect/kit/testing требует testcontainers — добавьте в зависимости сервиса',
        );
        expect(result.stdout, describeResult(result)).toContain('messaging:ok');
    });

    it("AC-1.2: /messaging без pg — forRoot с subscriber {dedupe: 'none'} собирается, с outbox — «@verdeect/kit/messaging требует pg …»", async () => {
        const result = await runInConsumer(dir(noTestcontainers), 'node', [
            'messaging-forroot.mjs',
        ]);

        expect(result.stdout.trim().split('\n'), describeResult(result)).toEqual([
            'dedupe-none:ok',
            'outbox:@verdeect/kit/messaging требует pg — добавьте в зависимости сервиса',
        ]);
    });

    it('AC-9.1: drizzle-kit загружает схему потребителя с @verdeect/kit/database и /idempotency — «No schema changes»', async () => {
        const result = await runInConsumer(dir(minimal), 'pnpm', [
            'exec',
            'drizzle-kit',
            'generate',
        ]);

        expect(result.code, describeResult(result)).toBe(0);
        expect(result.stdout + result.stderr).not.toContain('ERR_REQUIRE_ASYNC_MODULE');
        expect(result.stdout, describeResult(result)).toContain('No schema changes');
    });

    it('AC-3.8: изменение маршрута без pnpm openapi валит снимок', async () => {
        const project = dir(minimal);
        const controller = join(project, 'src', 'service', 'items.controller.ts');
        const original = await readFile(controller, 'utf8');
        await writeFile(
            controller,
            original.replace("@Controller('items')", "@Controller('goods')"),
        );
        try {
            const build = await runInConsumer(project, 'pnpm', ['build']);
            expect(build.code, describeResult(build)).toBe(0);

            const result = await runInConsumer(project, 'pnpm', [
                'exec',
                'vitest',
                'run',
                'src/openapi.spec.ts',
            ]);

            expect(result.code, describeResult(result)).not.toBe(0);
            expect(result.stdout + result.stderr).toContain('AC-3.8');
        } finally {
            await writeFile(controller, original);
            await runInConsumer(project, 'pnpm', ['build']);
        }
    });
});
