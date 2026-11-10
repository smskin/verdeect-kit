// Интеграционный контур (уровень I, prd.md §5): test/integration/**/*.spec.ts; контейнеры TEST_IMAGES — один раз на прогон
// в globalSetup через собственный startTestStack, воркеры получают адреса через inject. Эталон — O vitest.integration.config.ts.
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { TEST_TIMEOUT_SCALE } from './src/testing/timeout-scale.js';

const INCLUDE = ['test/integration/**/*.spec.ts'];

// isolated: файлы, которые пишут process.env / vi.stubEnv, используют vi.mock, патчат прототипы
// или инициализируют процесс-глобальное состояние; каждый — с причиной. Остальные — shared (skill-context «Fast Test Suites» (3)).
const ISOLATED: string[] = [];

export default defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
        environment: 'node',
        globalSetup: ['test/integration/global-setup.ts'],
        // Общий контейнер — файлы последовательно.
        fileParallelism: false,
        testTimeout: 60_000 * TEST_TIMEOUT_SCALE,
        hookTimeout: 180_000 * TEST_TIMEOUT_SCALE,
        // Inline project наследует корень (Vitest 5: plugins, globalSetup корня — один раз на прогон).
        // Проект с пустым include не добавляется: Vitest отверг бы его без файлов.
        projects: [
            {
                test: { name: 'shared', include: INCLUDE, exclude: ISOLATED, isolate: false },
            },
            ...(ISOLATED.length > 0
                ? [{ test: { name: 'isolated', include: ISOLATED, isolate: true } }]
                : []),
        ],
    },
});
