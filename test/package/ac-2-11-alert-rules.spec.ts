// AC-2.11 (R, UC-13, UC-16; NFR-9): alerts/verdeect-kit.rules.yml валиден для vmalert -dryRun, пороги вычисляются по
// умолчанию и с переопределением по service (vmalert-tool unittest), правило на каждую метрику пакета (prd.md §3.2).
// Нужен Docker: файл запускается make pack-check (job package CI); в make test проверяется только наличие файла.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { alertRulesTemplate, kitMetrics } from '../../src/observability/index.js';
import { REPO_ROOT, runCommand } from './support/pack.js';

// Текущий стабильный тег на 10.11.2026 — hub.docker.com/r/victoriametrics/vmalert/tags. Не образ контура сервиса,
// поэтому не в TEST_IMAGES (KT-10 п. 5).
const VMALERT_IMAGE = 'victoriametrics/vmalert:v1.156.0';
const VMALERT_TOOL_IMAGE = 'victoriametrics/vmalert-tool:v1.156.0';

const FIXTURES = join(REPO_ROOT, 'test', 'fixtures', 'alerts');
const THRESHOLDS = [
    'verdeect_kit_threshold:outbox_pending',
    'verdeect_kit_threshold:outbox_lag_seconds',
    'verdeect_kit_threshold:events_consumed',
    'verdeect_kit_threshold:db_pool_wait_timeouts',
    'verdeect_kit_threshold:rate_limit_unavailable',
];

interface AlertRule {
    readonly alert: string;
    readonly expr: string;
    readonly annotations: { readonly summary: string; readonly description: string };
}

const rules = (
    parse(readFileSync(alertRulesTemplate, 'utf8')) as {
        groups: { name: string; rules: AlertRule[] }[];
    }
).groups.flatMap((group) => group.rules);

/** Монтирование только для чтения: шаблон — /rules, тестовые данные — /tests. */
const MOUNTS = ['-v', `${join(REPO_ROOT, 'alerts')}:/rules:ro`, '-v', `${FIXTURES}:/tests:ro`];

describe('UC-13: шаблон алертов пакета', () => {
    it('AC-2.11: vmalert -dryRun принимает шаблон и пример переопределения', async () => {
        const result = await runCommand(
            'docker',
            [
                'run',
                '--rm',
                ...MOUNTS,
                VMALERT_IMAGE,
                '-dryRun',
                '-rule=/rules/verdeect-kit.rules.yml',
                '-rule=/tests/service-override.rules.yml',
            ],
            REPO_ROOT,
        );

        expect(result.code, result.stderr).toBe(0);
    });

    it('AC-2.11: пороги вычисляются — по умолчанию и с переопределением по service', async () => {
        const result = await runCommand(
            'docker',
            [
                'run',
                '--rm',
                ...MOUNTS,
                VMALERT_TOOL_IMAGE,
                'unittest',
                '--files=/tests/verdeect-kit.test.yml',
            ],
            REPO_ROOT,
        );

        expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('SUCCESS');
    });

    it('AC-2.11: правило на каждую метрику verdeect_* реестра kitMetrics', async () => {
        const names = (await kitMetrics({ service: 'kit-test' }).registry.getMetricsAsJSON())
            .map((metric) => metric.name)
            .filter((name) => name.startsWith('verdeect_'));

        expect(names).toHaveLength(5);
        for (const name of names) {
            expect(
                rules.some((rule) => new RegExp(`\\b${name}\\b`).test(rule.expr)),
                name,
            ).toBe(true);
        }
    });

    it('AC-2.11: у каждого правила переопределение порога и порог по умолчанию', () => {
        const used = new Set(
            rules.flatMap((rule) => rule.expr.match(/verdeect_kit_threshold:[a-z_]+/g) ?? []),
        );

        expect([...used].sort()).toEqual([...THRESHOLDS].sort());
        for (const rule of rules) {
            expect(rule.expr, rule.alert).toMatch(/verdeect_kit_threshold:[a-z_]+/);
            expect(rule.expr, rule.alert).toContain('on (service)');
            expect(rule.expr, rule.alert).toMatch(/or on \(service\)/);
        }
    });

    it('NFR-9: summary и description по-русски', () => {
        for (const rule of rules) {
            expect(rule.annotations.summary, rule.alert).toMatch(/[а-яё]/i);
            expect(rule.annotations.description, rule.alert).toMatch(/[а-яё]/i);
        }
    });
});
