// AC-9.4 (NFR-2, NFR-8): правила lint пакета на фикстурах — no-console и no-restricted-syntax (pgSchema с литералом,
// имена <svc>.<имя> известных сервисов) действуют только на src/**; комментарии и спецификаторы импорта не проверяются.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './support/pack.js';

const RULES = new Set(['no-console', 'no-restricted-syntax']);
const FIXTURES = join(REPO_ROOT, 'test', 'fixtures', 'lint');
const SRC_PATH = join(REPO_ROOT, 'src', 'config', 'lint-fixture.ts');

const eslint = new ESLint({ cwd: REPO_ROOT });

function fixture(name: string): string {
    return readFileSync(join(FIXTURES, name), 'utf8');
}

/** Сообщения правил AC-9.4 в виде `<строка>:<правило>`. */
async function ruleHits(source: string, filePath: string): Promise<string[]> {
    const [result] = await eslint.lintText(source, { filePath, warnIgnored: true });
    if (result === undefined) {
        return expect.fail('ESLint не вернул результат');
    }
    expect(result.messages.filter((message) => message.fatal === true)).toEqual([]);

    return result.messages
        .filter((message) => message.ruleId !== null && RULES.has(message.ruleId))
        .map((message) => `${message.line}:${message.ruleId}`)
        .sort();
}

describe('AC-9.4: правила lint пакета', () => {
    it('AC-9.4: нарушения в src/** — no-console и no-restricted-syntax на каждой помеченной строке', async () => {
        const source = fixture('violations.ts');
        const expected = source
            .split('\n')
            .flatMap((line, index) => {
                const match = /\/\/ expect: (\S+)/.exec(line);

                return match?.[1] === undefined ? [] : [`${index + 1}:${match[1]}`];
            })
            .sort();
        expect(expected.length).toBe(5);

        expect(await ruleHits(source, SRC_PATH)).toEqual(expected);
    });

    it('AC-9.4: комментарии, спецификаторы импорта и прочие строки не проверяются', async () => {
        expect(await ruleHits(fixture('allowed.ts'), SRC_PATH)).toEqual([]);
    });

    it('AC-9.4: test/** не проверяется', async () => {
        const path = join(REPO_ROOT, 'test', 'unit', 'lint-fixture.spec.ts');

        expect(await ruleHits(fixture('violations.ts'), path)).toEqual([]);
    });

    it('AC-9.4: исходники пакета проходят lint', async () => {
        const results = await eslint.lintFiles(['src/**/*.ts']);

        expect(results.length).toBeGreaterThan(0);
        expect(results.reduce((sum, result) => sum + result.errorCount, 0)).toBe(0);
    });
});
