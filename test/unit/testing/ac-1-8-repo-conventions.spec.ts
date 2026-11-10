// AC-1.8 (UC-1, UC-2): assertRepoConventions — эталонная фикстура проходит, каждая с нарушением падает с названием правила
// (prd.md §3.8 v1.7, G14, NFR-4). Фикстура — test/fixtures/repo-conventions/valid (реальные формы O).
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRepoConventions, baseComposeFile } from '../../../src/testing/repo-conventions.js';

const VALID = fileURLToPath(new URL('../../fixtures/repo-conventions/valid', import.meta.url));
const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function withFixture(mutate: (dir: string) => void = () => undefined): string {
    const dir = mkdtempSync(join(tmpdir(), 'kit-repo-'));
    dirs.push(dir);
    cpSync(VALID, dir, { recursive: true });
    mutate(dir);

    return dir;
}

/** Заменяет ровно одно вхождение from; нет вхождения — тест падает (фикстура не дрейфует молча). */
function edit(dir: string, file: string, from: string, to: string): void {
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    const count = text.split(from).length - 1;
    if (count !== 1) {
        expect.fail(`${file}: ожидалось одно вхождение «${from}», найдено ${count}`);
    }
    writeFileSync(path, text.replace(from, to));
}

function append(dir: string, file: string, text: string): void {
    const path = join(dir, file);
    writeFileSync(path, readFileSync(path, 'utf8') + text);
}

function messageOf(dir: string): string {
    try {
        assertRepoConventions({ root: dir });
    } catch (error) {
        return (error as Error).message;
    }

    return expect.fail('assertRepoConventions не упала');
}

function expectViolation(dir: string, rule: string, file?: string): string {
    const message = messageOf(dir);
    expect(message).toContain(file === undefined ? `[${rule}]` : `[${rule}] ${file}`);

    return message;
}

const APP_ENV = '      NODE_ENV: production\n';
const APP_COMMAND =
    '    command: ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]\n';
const WORKER_COMMAND = '    command: node --import ./dist/instrument.js dist/main.js\n';

describe('UC-1: правила репозитория сервиса', () => {
    it('AC-1.8: эталонная фикстура проходит', () => {
        expect(() => assertRepoConventions({ root: withFixture() })).not.toThrow();
    });

    it('AC-1.8: образ не из TEST_IMAGES в compose', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                'image: postgres:17.11-alpine3.24',
                'image: postgres:16.15-alpine3.24',
            ),
        );

        expect(expectViolation(dir, 'test-images', 'compose.yml')).toContain(
            'сервис db — образ postgres:16.15-alpine3.24, ожидается postgres:17.11-alpine3.24',
        );
    });

    it('AC-1.8: образ не из TEST_IMAGES в CI', () => {
        const dir = withFixture((d) =>
            edit(d, '.gitlab-ci.yml', 'postgres:17.11-alpine3.24', 'postgres:16.15-alpine3.24'),
        );

        expectViolation(dir, 'test-images', '.gitlab-ci.yml');
    });

    it('AC-1.8: адрес postgres:5432 в CI — не образ', () => {
        const dir = withFixture();
        expect(readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8')).toContain('@postgres:5432');

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: образ через интерполяцию вне TEST_IMAGES', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                'image: postgres:17.11-alpine3.24',
                'image: ${POSTGRES_IMAGE:-postgres:16.15-alpine3.24}',
            ),
        );

        expectViolation(dir, 'test-images', 'compose.yml');
    });

    it('AC-1.8: образ через интерполяцию с верным тегом', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                'image: postgres:17.11-alpine3.24',
                'image: ${POSTGRES_IMAGE:-postgres:17.11-alpine3.24}',
            ),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it.each([
        ['postgres:16', 'образ postgres:16, ожидается postgres:17.11-alpine3.24'],
        ['postgres', 'образ postgres:latest, ожидается postgres:17.11-alpine3.24'],
        [
            'docker.io/library/postgres:16.1',
            'образ postgres:16.1, ожидается postgres:17.11-alpine3.24',
        ],
        ['${PG_IMAGE:-postgres:16}', 'образ postgres:16, ожидается postgres:17.11-alpine3.24'],
        [
            'postgres:${PG_TAG}',
            'образ postgres:${PG_TAG} — тег не определён, ожидается postgres:17.11-alpine3.24',
        ],
    ])('AC-1.8: image: %s в compose — нарушение test-images', (image, detail) => {
        const dir = withFixture((d) =>
            edit(d, 'compose.yml', 'image: postgres:17.11-alpine3.24', `image: ${image}`),
        );

        expect(expectViolation(dir, 'test-images', 'compose.yml')).toContain(
            `сервис db — ${detail}`,
        );
    });

    it.each([
        'docker.io/library/postgres:17.11-alpine3.24',
        'postgres:17.11-alpine3.24@sha256:0123456789abcdef',
        '${APP_IMAGE}',
        'registry.local:5000/svc/app:${APP_TAG:-dev}',
        'traefik:v3.5',
    ])('AC-1.8: image: %s в compose — без нарушения', (image) => {
        const dir = withFixture((d) =>
            edit(d, 'compose.yml', 'image: postgres:17.11-alpine3.24', `image: ${image}`),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: переопределение со своим stop_grace_period — SHUTDOWN_TIMEOUT_MS из базового compose.yml', () => {
        const dir = withFixture((d) => {
            edit(d, 'compose.yml', 'SHUTDOWN_TIMEOUT_MS: "10000"', 'SHUTDOWN_TIMEOUT_MS: "20000"');
            edit(
                d,
                'compose.yml',
                '    stop_grace_period: 15s\n    command: ["node"',
                '    stop_grace_period: 30s\n    command: ["node"',
            );
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  app:\n    environment:\n      LOG_LEVEL: debug\n    stop_grace_period: 15s\n',
            );
        });

        expect(expectViolation(dir, 'stop-grace-period', 'compose.override.yml')).toContain(
            'сервис app — stop_grace_period 15000 мс ≤ SHUTDOWN_TIMEOUT_MS 20000 мс',
        );
    });

    it('AC-1.8: REPLICA_ID в compose', () => {
        const dir = withFixture((d) =>
            edit(d, 'compose.yml', APP_ENV, `${APP_ENV}      REPLICA_ID: \${REPLICA_ID:-}\n`),
        );

        expectViolation(dir, 'replica-id', 'compose.yml');
    });

    it('AC-1.8: REPLICA_ID в env_file', () => {
        const dir = withFixture((d) => append(d, 'app.env', 'REPLICA_ID=x\n'));

        expectViolation(dir, 'replica-id', 'app.env');
    });

    it('AC-1.8: stop_grace_period ≤ SHUTDOWN_TIMEOUT_MS', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                '    stop_grace_period: 15s\n    command: ["node"',
                '    stop_grace_period: 10s\n    command: ["node"',
            ),
        );

        expect(expectViolation(dir, 'stop-grace-period', 'compose.yml')).toContain(
            'сервис app — stop_grace_period 10000 мс ≤ SHUTDOWN_TIMEOUT_MS 10000 мс',
        );
    });

    it('AC-1.8: stop_grace_period не задан (10 с по умолчанию)', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                '    stop_grace_period: 15s\n    command: ["node"',
                '    command: ["node"',
            ),
        );

        expect(expectViolation(dir, 'stop-grace-period')).toContain('сервис app');
    });

    it('AC-1.8: SHUTDOWN_TIMEOUT_MS со значением по умолчанию в интерполяции', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                'SHUTDOWN_TIMEOUT_MS: "10000"',
                'SHUTDOWN_TIMEOUT_MS: "${SHUTDOWN_TIMEOUT_MS:-20000}"',
            ),
        );

        expect(expectViolation(dir, 'stop-grace-period')).toContain('SHUTDOWN_TIMEOUT_MS 20000 мс');
    });

    it('AC-1.8: ключ из env_file делает сервис приложением', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                '    env_file: ./app.env\n    stop_grace_period: 15s\n',
                '    env_file: ./app.env\n',
            ),
        );

        expect(expectViolation(dir, 'stop-grace-period', 'compose.yml')).toContain('сервис worker');
    });

    it('AC-1.8: ключ IDENTITY_PORT', () => {
        const dir = withFixture((d) =>
            edit(d, 'compose.yml', APP_ENV, `${APP_ENV}      IDENTITY_PORT: "3000"\n`),
        );

        expect(expectViolation(dir, 'env-keys', 'compose.yml')).toContain(
            'ключ IDENTITY_PORT, используйте PORT',
        );
    });

    it('AC-1.8: ключ BFF_PORT в env_file', () => {
        const dir = withFixture((d) => append(d, 'app.env', 'BFF_PORT=3000\n'));

        expectViolation(dir, 'env-keys', 'app.env');
    });

    it('AC-1.8: ключ SESSION_ENC_KEYS', () => {
        const dir = withFixture((d) =>
            edit(d, 'compose.yml', APP_ENV, `${APP_ENV}      SESSION_ENC_KEYS: "v1:abc"\n`),
        );

        expect(expectViolation(dir, 'env-keys')).toContain('используйте ENCRYPTION_KEYS');
    });

    it('AC-1.8: версия peer вне диапазона', () => {
        const dir = withFixture((d) =>
            edit(d, 'package.json', '"@nestjs/core": "12.1.3"', '"@nestjs/core": "11.0.0"'),
        );

        expect(expectViolation(dir, 'peer-versions', 'package.json')).toContain(
            '@nestjs/core 11.0.0 вне диапазона ^12.1.0 пакета @verdeect/kit',
        );
    });

    it('AC-1.8: версия peer не точная', () => {
        const dir = withFixture((d) =>
            edit(d, 'package.json', '"@nestjs/core": "12.1.3"', '"@nestjs/core": "^12.1.3"'),
        );

        expect(expectViolation(dir, 'peer-versions')).toContain('нужна точная версия');
    });

    it('AC-1.8: команда Dockerfile без --import', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'Dockerfile',
                '"--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"',
                '"--enable-source-maps", "dist/main.js"',
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'Dockerfile')).toContain(
            'CMD «node --enable-source-maps dist/main.js»',
        );
    });

    // Dev-стадия сервисов (verdeect-orchestrator/Dockerfile:54 и др.): подоболочка, фоновый `&`, `exec node`.
    const DEV_SUBSHELL = (build: string, imports: string): string =>
        `CMD ["sh", "-c", "${build} && (pnpm exec tsc -p tsconfig.build.json --watch --preserveWatchOutput & exec node --watch --inspect=0.0.0.0:9229 ${imports}--enable-source-maps dist/main.js)"]`;
    const DEV_CMD =
        'CMD ["sh", "-c", "pnpm build && node --watch --import ./dist/instrument.js dist/main.js"]';
    const PROD_CMD =
        'CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]';

    it.each([
        ['pnpm build', ''],
        ['pnpm --dir /app build', ''],
    ])(
        'AC-1.8: dev-стадия сервисов «%s && (… & exec node …)» без --import — нарушение',
        (build, imports) => {
            const dir = withFixture((d) =>
                edit(d, 'Dockerfile', DEV_CMD, DEV_SUBSHELL(build, imports)),
            );

            expect(expectViolation(dir, 'instrument-import', 'Dockerfile')).toContain(
                'exec node --watch --inspect=0.0.0.0:9229 --enable-source-maps dist/main.js',
            );
        },
    );

    it('AC-1.8: dev-стадия сервисов с --import ./dist/instrument.js — без нарушения', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'Dockerfile',
                DEV_CMD,
                DEV_SUBSHELL('pnpm build', '--import ./dist/instrument.js '),
            ),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: ENTRYPOINT ["node", …] + CMD ["dist/main.js"] без --import — нарушение', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'Dockerfile',
                PROD_CMD,
                'ENTRYPOINT ["node", "--enable-source-maps"]\nCMD ["dist/main.js"]',
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'Dockerfile')).toContain(
            'ENTRYPOINT + CMD «node --enable-source-maps dist/main.js»',
        );
    });

    it('AC-1.8: ENTRYPOINT с --import + CMD ["dist/main.js"] — без нарушения', () => {
        const dir = withFixture((d) => {
            edit(
                d,
                'Dockerfile',
                PROD_CMD,
                'ENTRYPOINT ["node", "--import", "./dist/instrument.js", "--enable-source-maps"]\nCMD ["dist/main.js"]',
            );
            // command: compose стал бы аргументами этого ENTRYPOINT (B6) — сервисы запускаются командой образа.
            edit(d, 'compose.yml', APP_COMMAND, '');
            edit(d, 'compose.yml', WORKER_COMMAND, '');
        });

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: ENTRYPOINT и CMD разных стадий не склеиваются', () => {
        const dir = withFixture((d) => {
            edit(d, 'Dockerfile', DEV_CMD, 'ENTRYPOINT ["node", "--enable-source-maps"]');
            edit(d, 'Dockerfile', PROD_CMD, 'CMD ["dist/main.js"]');
        });
        const message = messageOf(dir);

        // Склейки нет — нет и запуска node без --import; CMD ["dist/main.js"] сам по себе — не запуск node (v1.11).
        expect(message).not.toContain('[instrument-import]');
        expect(message).toContain(
            '[command-unrecognized] Dockerfile: CMD «dist/main.js» — команда не распознана: файл входа main.* на месте программы',
        );
    });

    it('AC-1.8: последний CMD стадии перекрывает предыдущие', () => {
        const dir = withFixture((d) =>
            edit(d, 'Dockerfile', PROD_CMD, `CMD ["node", "dist/main.js"]\n${PROD_CMD}`),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: команда с | и одиночным & вне подоболочки без --import — нарушение', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                'command: node --import ./dist/instrument.js dist/main.js',
                'command: sh -c "node dist/main.js | tee /tmp/app.log & wait"',
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
            'сервис worker «node dist/main.js»',
        );
    });

    it.each([
        ['--import ./dist/instrument.js ', false],
        ['', true],
    ])(
        'AC-1.8: перенаправление «exec node %sdist/main.js 2>&1 | tee /tmp/log» — нарушение: %s',
        (imports, violation) => {
            const dir = withFixture((d) =>
                edit(
                    d,
                    'compose.yml',
                    'command: node --import ./dist/instrument.js dist/main.js',
                    `command: sh -c "exec node ${imports}dist/main.js 2>&1 | tee /tmp/log"`,
                ),
            );

            if (violation) {
                expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
                    'сервис worker «exec node dist/main.js»',
                );
            } else {
                expect(() => assertRepoConventions({ root: dir })).not.toThrow();
            }
        },
    );

    it('AC-1.8: compose с множеством x-* якорей разбирается (снимок verdeect-orchestrator compose.e2e.yml)', () => {
        const services = Array.from(
            { length: 150 },
            (_, index) => `  cache-${index}:\n    <<: *redis\n`,
        ).join('');
        const dir = withFixture((d) =>
            writeFileSync(
                join(d, 'compose.cache.yml'),
                `x-redis: &redis\n  image: redis:7.4.11-alpine\nservices:\n${services}`,
            ),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: переопределение без command: наследует команду базового compose.yml (подделка остаётся подделкой)', () => {
        const dir = withFixture((d) => {
            append(
                d,
                'compose.yml',
                '  fakes:\n    build: .\n    environment:\n      NODE_ENV: test\n    command: ["node", "test/fakes/fake-services.main.ts"]\n',
            );
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  fakes:\n    environment:\n      LOG_LEVEL: debug\n',
            );
        });

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: файл compose сверх предела алиасов — ошибка разбора с именем файла', () => {
        const services = Array.from(
            { length: 1100 },
            (_, index) => `  cache-${index}:\n    <<: *redis\n`,
        ).join('');
        const dir = withFixture((d) =>
            writeFileSync(
                join(d, 'compose.big.yml'),
                `x-redis: &redis\n  image: redis:7.4.11-alpine\nservices:\n${services}`,
            ),
        );

        expect(() => assertRepoConventions({ root: dir })).toThrow(
            /^assertRepoConventions: не удалось разобрать compose\.big\.yml: /,
        );
    });

    // Одноразовые задания (prd.md §3.8 v1.9): `command:` без команды запуска приложения.
    const MIGRATE_JOB = (env: string, command = '["pnpm", "db:migrate"]'): string =>
        `  migrate:\n    build: .\n    environment:\n      NODE_ENV: production\n      LOG_LEVEL: info\n${env}    command: ${command}\n`;

    it('AC-1.8: одноразовое задание command: pnpm db:migrate с ключами envBase без stop_grace_period — не нарушение', () => {
        const dir = withFixture((d) => append(d, 'compose.yml', MIGRATE_JOB('')));

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: одноразовое задание с ключом IDENTITY_PORT — одно нарушение env-keys', () => {
        const dir = withFixture((d) =>
            append(d, 'compose.yml', MIGRATE_JOB('      IDENTITY_PORT: "3000"\n')),
        );

        const message = messageOf(dir);
        expect(message).toContain('нарушены правила (1)');
        expect(message).toContain(
            '[env-keys] compose.yml: сервис migrate — ключ IDENTITY_PORT, используйте PORT',
        );
    });

    it('AC-1.8: одноразовое задание node dist/cli.js migrate без --import — нет нарушения instrument-import', () => {
        const dir = withFixture((d) =>
            append(d, 'compose.yml', MIGRATE_JOB('', '["node", "dist/cli.js", "migrate"]')),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: command: унаследован из базового compose.yml, в override только environment: — одноразовое задание', () => {
        const dir = withFixture((d) => {
            append(d, 'compose.yml', MIGRATE_JOB('', '["node", "dist/cli.js", "migrate"]'));
            writeFileSync(
                join(d, 'compose.production.yml'),
                'services:\n  migrate:\n    environment:\n      NODE_ENV: production\n      LOG_LEVEL: warn\n',
            );
        });

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: command: sh -c "pnpm db:migrate && node dist/main.js" — приложение: stop-grace-period и instrument-import проверяются', () => {
        const dir = withFixture((d) =>
            append(
                d,
                'compose.yml',
                MIGRATE_JOB('', '\'sh -c "pnpm db:migrate && node dist/main.js"\''),
            ),
        );

        const message = messageOf(dir);
        expect(message).toContain('[stop-grace-period] compose.yml: сервис migrate');
        expect(message).toContain(
            '[instrument-import] compose.yml: сервис migrate «node dist/main.js»',
        );
    });

    it('AC-1.8: одноразовое задание с образом postgres:16 — нарушение test-images сохраняется', () => {
        const dir = withFixture((d) =>
            append(
                d,
                'compose.yml',
                '  db-migrate:\n    image: postgres:16\n    environment:\n      LOG_LEVEL: info\n    command: ["psql", "-f", "/migrations/all.sql"]\n',
            ),
        );

        const message = messageOf(dir);
        expect(message).toContain('нарушены правила (1)');
        expect(message).toContain(
            '[test-images] compose.yml: сервис db-migrate — образ postgres:16, ожидается postgres:17.11-alpine3.24',
        );
    });

    // Review 3 (KT-06): формы команд и наследование, которые правило пропускало.
    const BOOT = (command: string): string =>
        `  boot:\n    build: .\n    environment:\n      NODE_ENV: production\n    command: ${command}\n`;

    it('AC-1.8: многострочный sh -c «migrate\\nexec node dist/main.js» — приложение: stop-grace-period и instrument-import', () => {
        const dir = withFixture((d) =>
            append(
                d,
                'compose.yml',
                BOOT('["sh", "-c", "node dist/cli.js migrate\\nexec node dist/main.js"]'),
            ),
        );

        const message = messageOf(dir);
        expect(message).toContain('нарушены правила (2)');
        expect(message).toContain('[stop-grace-period] compose.yml: сервис boot');
        expect(message).toContain(
            '[instrument-import] compose.yml: сервис boot «exec node dist/main.js»',
        );
    });

    it('AC-1.8: sh -c «# wait for db\\nexec node dist/main.js» — приложение, запуск найден', () => {
        const dir = withFixture((d) =>
            append(
                d,
                'compose.yml',
                BOOT('["sh", "-c", "# wait for db\\nexec node dist/main.js"]'),
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
            'сервис boot «exec node dist/main.js»',
        );
    });

    it.each([
        '["sh", "-ec", "exec node dist/main.js"]',
        '["bash", "-lc", "exec node dist/main.js"]',
        '["sh", "-e", "-c", "exec node dist/main.js"]',
        '["bash", "-o", "pipefail", "-c", "exec node dist/main.js"]',
    ])('AC-1.8: %s — запуск приложения найден', (command) => {
        const dir = withFixture((d) => append(d, 'compose.yml', BOOT(command)));

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
            'сервис boot «exec node dist/main.js»',
        );
    });

    it('AC-1.8: ENTRYPOINT ["/sbin/tini", "--"] + CMD node dist/main.js без --import — нарушение', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'Dockerfile',
                PROD_CMD,
                'ENTRYPOINT ["/sbin/tini", "--"]\nCMD node dist/main.js',
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'Dockerfile')).toContain(
            'ENTRYPOINT + CMD «node dist/main.js»',
        );
    });

    it('AC-1.8: compose.override.yml с одним app: stop_grace_period: 5s при ключах envBase в базе — нарушение', () => {
        const dir = withFixture((d) =>
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  app:\n    stop_grace_period: 5s\n',
            ),
        );

        expect(expectViolation(dir, 'stop-grace-period', 'compose.override.yml')).toContain(
            'сервис app — stop_grace_period 5000 мс ≤ SHUTDOWN_TIMEOUT_MS 10000 мс',
        );
    });

    it.each(['docker-compose.yml', 'compose.yaml'])(
        'AC-1.8: база %s — наследование работает, ложных нарушений нет',
        (baseName) => {
            const dir = withFixture((d) => {
                renameSync(join(d, 'compose.yml'), join(d, baseName));
                writeFileSync(
                    join(d, 'compose.override.yml'),
                    'services:\n  app:\n    environment:\n      LOG_LEVEL: debug\n',
                );
            });

            expect(() => assertRepoConventions({ root: dir })).not.toThrow();
        },
    );

    it("AC-1.8: CMD ['node','dist/main.js'] — shell-форма, правила выполняются, файл не отвергнут", () => {
        // Невалидный JSON Docker выполняет как /bin/sh -c "['node','dist/main.js']" — команда `[node,dist/main.js]`,
        // не запуск node. Проверка файла продолжается: нарушение dev-стадии того же Dockerfile найдено.
        const dir = withFixture((d) => {
            edit(d, 'Dockerfile', PROD_CMD, "CMD ['node','dist/main.js']");
            edit(d, 'Dockerfile', 'node --watch --import ./dist/instrument.js', 'node --watch');
        });

        const message = expectViolation(dir, 'instrument-import', 'Dockerfile');
        expect(message).toContain('нарушены правила (1)');
        expect(message).not.toContain('не удалось разобрать');
    });

    it('AC-1.8: stop_grace_period: ${STOP_GRACE:-15s} — распознан', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                '    stop_grace_period: 15s\n    command: ["node"',
                '    stop_grace_period: ${STOP_GRACE:-15s}\n    command: ["node"',
            ),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: stop_grace_period: ${STOP_GRACE} без умолчания — «значение не определено»', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                '    stop_grace_period: 15s\n    command: ["node"',
                '    stop_grace_period: ${STOP_GRACE}\n    command: ["node"',
            ),
        );

        expect(expectViolation(dir, 'stop-grace-period', 'compose.yml')).toContain(
            'сервис app — stop_grace_period «${STOP_GRACE}» — значение не определено',
        );
    });

    it('AC-1.8: SHUTDOWN_TIMEOUT_MS=20000 # ms в env_file — читается 20000', () => {
        const dir = withFixture((d) =>
            edit(d, 'app.env', 'SHUTDOWN_TIMEOUT_MS=10000', 'SHUTDOWN_TIMEOUT_MS=20000 # ms'),
        );

        expect(expectViolation(dir, 'stop-grace-period', 'compose.yml')).toContain(
            'сервис worker — stop_grace_period 15000 мс ≤ SHUTDOWN_TIMEOUT_MS 20000 мс',
        );
    });

    it('AC-1.8: SHUTDOWN_TIMEOUT_MS="20000 # ms" в env_file — значение с комментарием, нарушение формата', () => {
        const dir = withFixture((d) =>
            edit(d, 'app.env', 'SHUTDOWN_TIMEOUT_MS=10000', 'SHUTDOWN_TIMEOUT_MS="20000 # ms"'),
        );

        const message = expectViolation(dir, 'stop-grace-period', 'compose.yml');
        expect(message).toContain(
            'сервис worker — SHUTDOWN_TIMEOUT_MS — значение не определено или не целое число мс',
        );
        expect(message).not.toContain('20000 # ms');
    });

    it('AC-1.8: POSTGRES_IMAGE: docker.io/library/postgres:16.15-alpine3.24 в CI — сравнивается как postgres:16.15-alpine3.24', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                '.gitlab-ci.yml',
                'POSTGRES_IMAGE: postgres:17.11-alpine3.24',
                'POSTGRES_IMAGE: docker.io/library/postgres:16.15-alpine3.24',
            ),
        );

        expect(expectViolation(dir, 'test-images', '.gitlab-ci.yml')).toContain(
            'образ postgres:16.15-alpine3.24, ожидается postgres:17.11-alpine3.24',
        );
    });

    it('AC-1.8: node --watch-path src dist/main.js — файл входа dist/main.js', () => {
        const dir = withFixture((d) =>
            append(d, 'compose.yml', BOOT('["node", "--watch-path", "src", "dist/main.js"]')),
        );

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
            'сервис boot «node --watch-path src dist/main.js»',
        );
    });

    it('AC-1.8: одноразовое задание «pnpm db:migrate\\n# done» остаётся одноразовым', () => {
        const dir = withFixture((d) =>
            append(d, 'compose.yml', BOOT('["sh", "-c", "pnpm db:migrate\\n# done"]')),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it("AC-1.8: sh -c с '#' внутри кавычек не режется", () => {
        const dir = withFixture((d) =>
            append(
                d,
                'compose.yml',
                BOOT(
                    `["sh", "-c", "echo 'step # 1' && node --import ./dist/instrument.js dist/main.js"]`,
                ),
            ),
        );

        const message = expectViolation(dir, 'stop-grace-period', 'compose.yml');
        expect(message).toContain('сервис boot');
        expect(message).not.toContain('[instrument-import]');
    });

    it('AC-1.8: команда dev-стадии через sh -c без --import', () => {
        const dir = withFixture((d) =>
            edit(d, 'Dockerfile', 'node --watch --import ./dist/instrument.js', 'node --watch'),
        );

        expectViolation(dir, 'instrument-import', 'Dockerfile');
    });

    it('AC-1.8: скрипт start без --import', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'package.json',
                '"start": "node --enable-source-maps --import ./dist/instrument.js dist/main.js"',
                '"start": "node --enable-source-maps dist/main.js"',
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'package.json')).toContain(
            'scripts.start',
        );
    });

    it('AC-1.8: command: compose без --import', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                '["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]',
                '["node", "--enable-source-maps", "dist/main.js"]',
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain('сервис app');
    });

    it('AC-1.8: инфраструктурный сервис без --import — не нарушение', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                '      POSTGRES_PASSWORD: secret\n',
                '      POSTGRES_PASSWORD: secret\n    command: ["postgres", "-c", "fsync=off"]\n',
            ),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: подделка fake-services.main.ts без --import — не нарушение', () => {
        const dir = withFixture((d) =>
            edit(d, 'compose.e2e.yml', '"--import", "./test/fakes/register.mjs", ', ''),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: redaction.ts импортирует модуль приложения', () => {
        const dir = withFixture((d) =>
            append(d, 'src/redaction.ts', "import { config } from './config.js';\n"),
        );

        expect(expectViolation(dir, 'redaction-imports', 'src/redaction.ts')).toContain(
            'импорт ./config.js',
        );
    });

    it('AC-1.8: redaction.ts — export … from', () => {
        const dir = withFixture((d) =>
            append(d, 'src/redaction.ts', "export { x } from './x.js';\n"),
        );

        expectViolation(dir, 'redaction-imports');
    });

    it('AC-1.8: несколько нарушений — одним списком', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                APP_ENV,
                `${APP_ENV}      IDENTITY_PORT: "3000"\n      REPLICA_ID: api-1\n`,
            ),
        );

        const message = messageOf(dir);

        expect(message).toContain('нарушены правила (2)');
        expect(message).toContain('[replica-id]');
        expect(message).toContain('[env-keys]');
        expect(message.indexOf('[replica-id]')).toBeLessThan(message.indexOf('[env-keys]'));
    });

    it('AC-1.8: значения окружения не в тексте', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                APP_ENV,
                `${APP_ENV}      IDENTITY_PORT: "3000-SECRET_MARKER"\n`,
            ),
        );

        expect(messageOf(dir)).not.toContain('SECRET_MARKER');
    });

    it('AC-1.8: монорепозиторий — apps/svc/package.json', () => {
        const dir = withFixture((d) => {
            mkdirSync(join(d, 'apps', 'svc'), { recursive: true });
            renameSync(join(d, 'package.json'), join(d, 'apps', 'svc', 'package.json'));
            renameSync(join(d, 'Dockerfile'), join(d, 'apps', 'svc', 'Dockerfile'));
            edit(
                d,
                'apps/svc/package.json',
                '"@nestjs/core": "12.1.3"',
                '"@nestjs/core": "11.0.0"',
            );
        });

        expectViolation(dir, 'peer-versions', 'apps/svc/package.json');
    });
});

describe('AC-1.8: базовый файл Compose', () => {
    const files = (...names: string[]): Parameters<typeof baseComposeFile>[0] => ({
        compose: names.map((file) => ({
            file,
            name: 'app',
            image: null,
            env: new Map(),
            envSource: new Map(),
            envMode: 'merge' as const,
            stopGracePeriod: undefined,
            command: undefined,
            entrypoint: undefined,
            build: undefined,
        })),
        ci: [],
        docker: [],
        manifests: [],
        redaction: [],
    });

    it.each(['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'])(
        'AC-1.8: baseComposeFile — %s рядом с переопределением — база',
        (name) => {
            expect(baseComposeFile(files('compose.override.yml', name))).toBe(name);
        },
    );

    it('AC-1.8: baseComposeFile — порядок поиска Compose: compose.yaml раньше compose.yml и docker-compose.*', () => {
        expect(baseComposeFile(files('docker-compose.yml', 'compose.yml', 'compose.yaml'))).toBe(
            'compose.yaml',
        );
        expect(baseComposeFile(files('docker-compose.yml', 'docker-compose.yaml'))).toBe(
            'docker-compose.yaml',
        );
        expect(baseComposeFile(files('compose.override.yml'))).toBeNull();
    });
});

describe('UC-1: формы команды запуска (§3.8 v1.10)', () => {
    const PROD_CMD =
        'CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]';
    const DEV_CMD =
        'CMD ["sh", "-c", "pnpm build && node --watch --import ./dist/instrument.js dist/main.js"]';
    /** Команда сервиса app в compose.yml. */
    const appCommand = (command: string) => (d: string) =>
        edit(d, 'compose.yml', APP_COMMAND, `    command: ${command}\n`);
    const unrecognized = (dir: string): string =>
        expectViolation(dir, 'command-unrecognized', 'compose.yml');

    it.each([
        ['["bash", "-eo", "pipefail", "-c", "exec node dist/main.js"]'],
        ['["bash", "-euo", "pipefail", "-c", "exec node dist/main.js"]'],
    ])(
        'AC-1.8: A1 — %s: флаги с o склеены, скрипт раскрыт, нет --import — нарушение',
        (command) => {
            const dir = withFixture(appCommand(command));

            expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
                'сервис app «exec node dist/main.js» — нет --import',
            );
        },
    );

    it('AC-1.8: A2 — ENTRYPOINT ["sh", "-c", "<скрипт>"]: запуск ищется в скрипте, CMD — только $0…', () => {
        const dir = withFixture((d) => {
            edit(
                d,
                'Dockerfile',
                PROD_CMD,
                `ENTRYPOINT ["sh", "-c", "exec node dist/main.js"]\n${PROD_CMD}`,
            );
            edit(d, 'compose.yml', APP_COMMAND, '');
            edit(d, 'compose.yml', WORKER_COMMAND, '');
        });

        expect(expectViolation(dir, 'instrument-import', 'Dockerfile')).toContain(
            'ENTRYPOINT + CMD «exec node dist/main.js» — нет --import',
        );
    });

    it('AC-1.8: A3 — env_file SHUTDOWN_TIMEOUT_MS="20000" # ms читается как 20000', () => {
        const dir = withFixture((d) =>
            edit(d, 'app.env', 'SHUTDOWN_TIMEOUT_MS=10000', 'SHUTDOWN_TIMEOUT_MS="20000" # ms'),
        );

        expect(expectViolation(dir, 'stop-grace-period', 'compose.yml')).toContain(
            'сервис worker — stop_grace_period 15000 мс ≤ SHUTDOWN_TIMEOUT_MS 20000 мс',
        );
    });

    it('AC-1.8: A4 — ключ envBase только в переопределении делает команду базы приложением', () => {
        const dir = withFixture((d) => {
            append(d, 'compose.yml', '  api:\n    build: .\n    command: node dist/main.js\n');
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  api:\n    stop_grace_period: 15s\n    environment:\n      LOG_LEVEL: debug\n',
            );
        });

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
            'сервис api «node dist/main.js» — нет --import',
        );
    });

    it('AC-1.8: A4 — IDENTITY_PORT из базы проверяется на слитом сервисе', () => {
        const dir = withFixture((d) => {
            append(
                d,
                'compose.yml',
                '  api:\n    build: .\n    environment:\n      IDENTITY_PORT: "3000"\n    command: node --import ./dist/instrument.js dist/main.js\n',
            );
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  api:\n    stop_grace_period: 15s\n    environment:\n      LOG_LEVEL: debug\n',
            );
        });

        expect(expectViolation(dir, 'env-keys', 'compose.yml')).toContain(
            'сервис api — ключ IDENTITY_PORT, используйте PORT',
        );
    });

    it('AC-1.8: A5 — stop_grace_period: !reset null — умолчание 10s, значение базы не наследуется', () => {
        const dir = withFixture((d) =>
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  app:\n    stop_grace_period: !reset null\n',
            ),
        );

        expect(expectViolation(dir, 'stop-grace-period', 'compose.override.yml')).toContain(
            'сервис app — stop_grace_period 10000 мс ≤ SHUTDOWN_TIMEOUT_MS 10000 мс',
        );
    });

    it('AC-1.8: A5 — command: !reset [] — задание базы в переопределении запускается командой образа (приложение)', () => {
        const dir = withFixture((d) => {
            append(
                d,
                'compose.yml',
                '  migrate:\n    build: .\n    environment:\n      LOG_LEVEL: info\n    command: pnpm db:migrate\n',
            );
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  migrate:\n    command: !reset []\n',
            );
        });

        expect(expectViolation(dir, 'stop-grace-period', 'compose.override.yml')).toContain(
            'сервис migrate — stop_grace_period 10000 мс',
        );
    });

    it('AC-1.8: A5 — environment: !reset {} — ключи базы не наследуются, сервис — инфраструктура', () => {
        const dir = withFixture((d) =>
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  app:\n    stop_grace_period: 5s\n    environment: !reset {}\n',
            ),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: A5 — environment: !override — SHUTDOWN_TIMEOUT_MS базы не наследуется', () => {
        const dir = withFixture((d) => {
            edit(d, 'compose.yml', 'SHUTDOWN_TIMEOUT_MS: "10000"', 'SHUTDOWN_TIMEOUT_MS: "20000"');
            writeFileSync(
                join(d, 'compose.override.yml'),
                'services:\n  app:\n    stop_grace_period: 15s\n    environment: !override\n      NODE_ENV: production\n',
            );
        });

        // Без !override слитое окружение дало бы 20000 и нарушение в compose.override.yml.
        expect(expectViolation(dir, 'stop-grace-period', 'compose.yml')).not.toContain(
            'compose.override.yml',
        );
    });

    it('AC-1.8: A6 — «\\» с пробелами и табуляцией перед переводом строки — продолжение', () => {
        const dir = withFixture((d) =>
            edit(d, 'Dockerfile', PROD_CMD, 'CMD ["node", \\  \t\n    "dist/main.js"]'),
        );

        expect(expectViolation(dir, 'instrument-import', 'Dockerfile')).toContain(
            'CMD «node dist/main.js» — нет --import',
        );
    });

    it('AC-1.8: A6 — CMD внутри HEALTHCHECK — не CMD стадии', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'Dockerfile',
                PROD_CMD,
                `${PROD_CMD}\nHEALTHCHECK --interval=5s \\ \n  CMD node dist/main.js`,
            ),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: tini -- sh -c "node dist/main" без --import — нарушение (файл входа main без расширения)', () => {
        const dir = withFixture(appCommand('["tini", "--", "sh", "-c", "node dist/main"]'));

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
            'сервис app «node dist/main» — нет --import',
        );
    });

    it('AC-1.8: entrypoint: + command: compose склеиваются, CMD образа отброшен — нарушение', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'compose.yml',
                APP_COMMAND,
                '    entrypoint: ["node", "--enable-source-maps"]\n    command: ["dist/main.js"]\n',
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
            'сервис app «node --enable-source-maps dist/main.js» — нет --import',
        );
    });

    it('AC-1.8: command: без entrypoint: — аргументы ENTRYPOINT стадии build.target', () => {
        const dir = withFixture((d) => {
            edit(d, 'Dockerfile', PROD_CMD, 'ENTRYPOINT ["node", "--enable-source-maps"]');
            edit(
                d,
                'compose.yml',
                `    build: .\n    environment:\n      NODE_ENV: production\n`,
                `    build:\n      context: .\n      target: prod\n    environment:\n      NODE_ENV: production\n`,
            );
            edit(d, 'compose.yml', APP_COMMAND, '    command: ["dist/main.js"]\n');
            edit(
                d,
                'compose.yml',
                WORKER_COMMAND,
                '    command: ["--import", "./dist/instrument.js", "dist/main.js"]\n',
            );
        });
        const message = expectViolation(dir, 'instrument-import', 'compose.yml');

        expect(message).toContain('сервис app «node --enable-source-maps dist/main.js»');
        expect(message).not.toContain('сервис worker');
    });

    it('AC-1.8: FROM <стадия> наследует ENTRYPOINT — нарушение в дочерней стадии', () => {
        const dir = withFixture((d) => {
            edit(
                d,
                'Dockerfile',
                `FROM node:24-alpine AS prod\n${PROD_CMD}`,
                'FROM node:24-alpine AS runtime\nENTRYPOINT ["node", "--enable-source-maps"]\n\nFROM runtime AS prod\nCMD ["dist/main.js"]',
            );
            edit(d, 'compose.yml', APP_COMMAND, '');
            edit(d, 'compose.yml', WORKER_COMMAND, '');
        });

        expect(expectViolation(dir, 'instrument-import', 'Dockerfile')).toContain(
            'ENTRYPOINT + CMD «node --enable-source-maps dist/main.js»',
        );
    });

    it('AC-1.8: ENTRYPOINT дочерней стадии сбрасывает унаследованный CMD', () => {
        const dir = withFixture((d) => {
            edit(
                d,
                'Dockerfile',
                `FROM node:24-alpine AS prod\n${PROD_CMD}`,
                `FROM node:24-alpine AS runtime\nCMD ["dist/main.js"]\n\nFROM runtime AS prod\nENTRYPOINT ["node", "--import", "./dist/instrument.js", "dist/main.js"]`,
            );
            edit(d, 'compose.yml', APP_COMMAND, '');
            edit(d, 'compose.yml', WORKER_COMMAND, '');
            // fakes с command: стал бы аргументами этого ENTRYPOINT (B6).
            rmSync(join(d, 'compose.e2e.yml'));
        });

        // С унаследованным CMD было бы «… dist/main.js dist/main.js».
        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it.each([
        ['pnpm start', 'раннер pnpm'],
        ['npm run start:prod', 'раннер npm'],
        ['["gosu", "node", "node", "dist/main.js"]', 'обёртка с аргументами gosu'],
        [
            'node --max-old-space-size 512 dist/main.js',
            'файл входа main.* не на месте первого аргумента node',
        ],
        ['["sh", "-c", "exec node $(cat entry)"]', 'подстановка команд'],
        ['["sh", "-c", "exec node $ENTRY"]', 'переменная без умолчания'],
        ['["sh", "-c", "eval node dist/main.js"]', 'eval'],
        ['["node", "--run", "start"]', 'раннер node --run'],
    ])('AC-1.8: command: %s — command-unrecognized «%s»', (command, form) => {
        const dir = withFixture(appCommand(command));

        expect(unrecognized(dir)).toContain(`— команда не распознана: ${form}`);
        expect(unrecognized(dir)).toContain(
            'нужна форма node --import ./dist/instrument.js dist/main.js',
        );
    });

    it('AC-1.8: ${ENTRY:-dist/main.js} раскрывается умолчанием — форма распознана', () => {
        const dir = withFixture(
            appCommand('node --import ./dist/instrument.js ${ENTRY:-dist/main.js}'),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: scripts.start: nest start — command-unrecognized в package.json', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'package.json',
                '"start": "node --enable-source-maps --import ./dist/instrument.js dist/main.js"',
                '"start": "nest start"',
            ),
        );

        expect(expectViolation(dir, 'command-unrecognized', 'package.json')).toContain(
            'scripts.start «nest start» — команда не распознана: раннер nest',
        );
    });

    it.each([
        ['environment', '      NODE_OPTIONS: --import ./dist/instrument.js\n'],
        ['команде', ''],
    ])(
        'AC-1.8: --import через NODE_OPTIONS (в %s) не засчитывается — instrument-import',
        (_, env) => {
            const dir = withFixture((d) => {
                edit(d, 'compose.yml', APP_ENV, `${APP_ENV}${env}`);
                appCommand(
                    env === ''
                        ? '["sh", "-c", "NODE_OPTIONS=\'--import ./dist/instrument.js\' exec node dist/main.js"]'
                        : 'node dist/main.js',
                )(d);
            });

            expectViolation(dir, 'instrument-import', 'compose.yml');
        },
    );

    it('AC-1.8: ENV NODE_OPTIONS=--import … в Dockerfile не засчитывается', () => {
        const dir = withFixture((d) =>
            edit(
                d,
                'Dockerfile',
                PROD_CMD,
                'ENV NODE_OPTIONS="--import ./dist/instrument.js"\nCMD ["node", "dist/main.js"]',
            ),
        );

        expect(expectViolation(dir, 'instrument-import', 'Dockerfile')).toContain(
            'CMD «node dist/main.js»',
        );
    });

    it.each([['pnpm db:migrate'], ['node dist/cli.js migrate']])(
        'AC-1.8: %s — одноразовое задание, не command-unrecognized',
        (command) => {
            const dir = withFixture(appCommand(command));

            expect(() => assertRepoConventions({ root: dir })).not.toThrow();
        },
    );

    it('AC-1.8: dumb-init -- node --import ./dist/instrument.js dist/main.js — без нарушения', () => {
        const dir = withFixture(
            appCommand('dumb-init -- node --import ./dist/instrument.js dist/main.js'),
        );

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });

    it('AC-1.8: инфраструктура с pnpm start и стадия без ссылок из compose — не проверяются', () => {
        const dir = withFixture((d) => {
            append(
                d,
                'compose.yml',
                '  tool:\n    image: node:24-alpine\n    command: pnpm start\n',
            );
            edit(d, 'Dockerfile', DEV_CMD, 'CMD ["pnpm", "start"]');
        });

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });
});

describe('UC-1: правило команды «на запрет» (§3.8 v1.11)', () => {
    const PROD_CMD =
        'CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]';
    const appCommand = (command: string) => (d: string) =>
        edit(d, 'compose.yml', APP_COMMAND, `    command: ${command}\n`);
    /** Сервисы запускаются командой образа: command: app и worker убраны. */
    const imageCommand = (d: string, dockerfile: string): void => {
        edit(d, 'Dockerfile', PROD_CMD, dockerfile);
        edit(d, 'compose.yml', APP_COMMAND, '');
        edit(d, 'compose.yml', WORKER_COMMAND, '');
    };

    it('AC-1.8: приложение без command: — ENTRYPOINT ["./docker-entrypoint.sh"] + CMD ["node", "dist/main.js"] — command-unrecognized', () => {
        const dir = withFixture((d) =>
            imageCommand(d, 'ENTRYPOINT ["./docker-entrypoint.sh"]\nCMD ["node", "dist/main.js"]'),
        );

        expect(expectViolation(dir, 'command-unrecognized', 'Dockerfile')).toContain(
            '«./docker-entrypoint.sh node dist/main.js» — команда не распознана',
        );
    });

    it('AC-1.8: приложение без command: — ENTRYPOINT ["./run.sh"] без CMD — «не найден запуск приложения»', () => {
        const dir = withFixture((d) => imageCommand(d, 'ENTRYPOINT ["./run.sh"]'));

        expect(expectViolation(dir, 'command-unrecognized', 'Dockerfile')).toContain(
            'не найден запуск приложения: ./run.sh',
        );
    });

    it('AC-1.8: command: ["node", "dist/main.js"] поверх ENTRYPOINT-скрипта — command-unrecognized', () => {
        const dir = withFixture((d) => {
            edit(d, 'Dockerfile', PROD_CMD, 'ENTRYPOINT ["./docker-entrypoint.sh"]');
            appCommand('["node", "dist/main.js"]')(d);
        });

        expect(expectViolation(dir, 'command-unrecognized', 'compose.yml')).toContain(
            'сервис app «./docker-entrypoint.sh node dist/main.js» — команда не распознана',
        );
    });

    it('AC-1.8: ENTRYPOINT ["/bin/sh", "/entrypoint.sh"] + CMD node … — command-unrecognized', () => {
        const dir = withFixture((d) =>
            imageCommand(
                d,
                'ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]\nCMD ["node", "--import", "./dist/instrument.js", "dist/main.js"]',
            ),
        );

        expectViolation(dir, 'command-unrecognized', 'Dockerfile');
    });

    it.each([
        ['["bash", "--xyz", "1", "-c", "node dist/main.js"]', 'вызов оболочки не распознан'],
        [
            '["tini", "-x", "--", "node", "--import", "./dist/instrument.js", "dist/main.js"]',
            'опция обёртки -x',
        ],
        ['node $NODE_FLAGS dist/main.js', 'переменная без умолчания'],
    ])('AC-1.8: command: %s — command-unrecognized «%s»', (command, form) => {
        const dir = withFixture(appCommand(command));

        expect(expectViolation(dir, 'command-unrecognized', 'compose.yml')).toContain(
            `команда не распознана: ${form}`,
        );
    });

    it.each([
        ['["bash", "--login", "-c", "node dist/main.js"]'],
        ['["bash", "--rcfile", "f", "-c", "node dist/main.js"]'],
        ['["bash", "-O", "extglob", "-c", "node dist/main.js"]'],
        ['["bash", "--norc", "--posix", "-c", "node dist/main.js"]'],
    ])('AC-1.8: command: %s — скрипт раскрыт, нет --import — нарушение', (command) => {
        const dir = withFixture(appCommand(command));

        expect(expectViolation(dir, 'instrument-import', 'compose.yml')).toContain(
            'сервис app «node dist/main.js» — нет --import',
        );
    });

    it.each([
        ['["tini", "-s", "--", "node", "--import", "./dist/instrument.js", "dist/main.js"]'],
        [
            '["tini", "-p", "SIGTERM", "--", "node", "--import", "./dist/instrument.js", "dist/main.js"]',
        ],
        ['["dumb-init", "-c", "node", "--import", "./dist/instrument.js", "dist/main.js"]'],
        [
            '["dumb-init", "--rewrite", "15:2", "--", "node", "--import", "./dist/instrument.js", "dist/main.js"]',
        ],
        ['node --import ./dist/instrument.js dist/main.js --port $PORT'],
        ['pnpm db:migrate'],
        ['node dist/cli.js migrate'],
    ])('AC-1.8: command: %s — без нарушения', (command) => {
        const dir = withFixture(appCommand(command));

        expect(() => assertRepoConventions({ root: dir })).not.toThrow();
    });
});

describe('UC-1: обязательный запуск у стадии приложения (§3.8 v1.11)', () => {
    const PROD_CMD =
        'CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]';

    it('AC-1.8: приложение с image: без build: — последняя стадия ENTRYPOINT ["./run.sh"] — «не найден запуск приложения»', () => {
        const dir = withFixture((d) => {
            edit(d, 'Dockerfile', PROD_CMD, 'ENTRYPOINT ["./run.sh"]');
            edit(d, 'compose.yml', APP_COMMAND, '');
            edit(d, 'compose.yml', WORKER_COMMAND, '');
            for (const file of ['compose.yml', 'compose.e2e.yml']) {
                const path = join(d, file);
                writeFileSync(
                    path,
                    readFileSync(path, 'utf8').replaceAll('    build: .\n', '    image: svc:dev\n'),
                );
            }
        });

        expect(expectViolation(dir, 'command-unrecognized', 'Dockerfile')).toContain(
            'не найден запуск приложения: ./run.sh',
        );
    });

    it('AC-1.8: стадия приложения без CMD и ENTRYPOINT — «не найден запуск приложения: нет CMD и ENTRYPOINT»', () => {
        const dir = withFixture((d) => {
            edit(d, 'Dockerfile', PROD_CMD, '');
            edit(d, 'compose.yml', APP_COMMAND, '');
            edit(d, 'compose.yml', WORKER_COMMAND, '');
        });

        expect(expectViolation(dir, 'command-unrecognized', 'Dockerfile')).toContain(
            'стадия prod — команда не распознана: не найден запуск приложения: нет CMD и ENTRYPOINT',
        );
    });
});
