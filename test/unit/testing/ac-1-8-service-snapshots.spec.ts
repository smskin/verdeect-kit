// AC-1.8 (UC-1, UC-2): assertRepoConventions на снимках реальных репозиториев сервисов (prd.md §3.8, §10).
// Снимки — test/fixtures/services/<svc>/ (Dockerfile, compose*.yml, .gitlab-ci.yml, package.json; SOURCE — путь и коммит),
// скопированы через git show без изменений исходных репозиториев. Ожидаемые нарушения сверены с файлами вручную:
// каждое соответствует правилу §3.8 v1.9 — это выравнивание сервисов при переходе (§10), а не ложное срабатывание.
// Одноразовые задания (command: без запуска приложения: *-migrate, *plan-apply) stop-grace-period и --import не проверяются.
// Обновление снимка: новый коммит в SOURCE и пересверка списка.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertRepoConventions } from '../../../src/testing/repo-conventions.js';

const ROOT = fileURLToPath(new URL('../../fixtures/services/', import.meta.url));

const DEV_CMD =
    'CMD «exec node --watch --inspect=0.0.0.0:9229 --enable-source-maps dist/main.js» — нет --import …instrument';
const PROD_CMD = 'CMD «node --enable-source-maps dist/main.js» — нет --import …instrument';

/** Нарушения в виде «правило | файл | сервис (или деталь, если сервиса нет)». */
function violations(service: string): string[] {
    try {
        assertRepoConventions({ root: `${ROOT}${service}` });
    } catch (error) {
        return (error as Error).message
            .split('\n')
            .slice(1)
            .map((line) => {
                const match = /^- \[([a-z-]+)\] ([^:]+): (.*)$/.exec(line);
                if (match === null) {
                    return `не разобрано: ${line}`;
                }
                const [, rule, file, detail = ''] = match;
                const subject = /^сервис (\S+)/.exec(detail)?.[1] ?? detail;

                return `${rule} | ${file} | ${subject}`;
            });
    }

    return [];
}

const EXPECTED: Readonly<Record<string, readonly string[]>> = {
    bff: [
        'env-keys | compose.e2e.yml | bff-e2e',
        'env-keys | compose.e2e.yml | bff-admin-e2e',
        'env-keys | compose.override.yml | bff',
        'env-keys | compose.production.yml | bff-app',
        'env-keys | compose.production.yml | bff-admin',
        `instrument-import | Dockerfile | ${DEV_CMD}`,
        `instrument-import | Dockerfile | ${PROD_CMD}`,
    ],
    identity: [
        'test-images | .gitlab-ci.yml | образ postgres:16.15-alpine3.24, ожидается postgres:17.11-alpine3.24',
        'test-images | compose.override.yml | postgres',
        'stop-grace-period | compose.e2e.yml | identity',
        'stop-grace-period | compose.override.yml | identity',
        'stop-grace-period | compose.production.yml | identity',
        'env-keys | compose.e2e.yml | identity',
        'env-keys | compose.e2e.yml | identity',
        'env-keys | compose.override.yml | identity',
        'env-keys | compose.production.yml | identity',
        'env-keys | compose.production.yml | identity',
        'instrument-import | compose.e2e.yml | identity',
        `instrument-import | Dockerfile | ${DEV_CMD}`,
        `instrument-import | Dockerfile | ${PROD_CMD}`,
    ],
    orchestrator: [
        'replica-id | compose.e2e.yml | orchestrator-e2e',
        'replica-id | compose.e2e.yml | platform-e2e-plan-apply',
        'replica-id | compose.e2e.yml | platform-e2e',
        'replica-id | compose.production.yml | orchestrator',
        'stop-grace-period | compose.e2e.yml | platform-e2e',
        'stop-grace-period | compose.e2e.yml | node-agent-e2e-1',
        'stop-grace-period | compose.e2e.yml | node-agent-e2e-2',
        'stop-grace-period | compose.override.yml | node-agent',
        'env-keys | compose.e2e.yml | orchestrator-e2e',
        'env-keys | compose.override.yml | orchestrator',
        'env-keys | compose.production.yml | orchestrator',
        `instrument-import | Dockerfile | ${DEV_CMD}`,
        `instrument-import | Dockerfile | ${PROD_CMD}`,
    ],
    platform: [
        'stop-grace-period | compose.override.yml | platform',
        'stop-grace-period | compose.production.yml | platform',
        `instrument-import | Dockerfile | ${DEV_CMD}`,
        `instrument-import | Dockerfile | ${PROD_CMD}`,
    ],
};

describe('UC-2: правила репозитория на снимках сервисов', () => {
    it.each(Object.keys(EXPECTED))(
        'AC-1.8: %s — полный список нарушений совпадает с ожидаемым',
        (service) => {
            expect(violations(service)).toEqual(EXPECTED[service]);
        },
    );
});
