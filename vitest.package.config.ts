// Контур проверок пакета (уровни R и C, prd.md §5): архив, проекты-потребители test/consumer, publish.mjs, правила lint;
// запуск — pnpm pack:check после сборки. Образец — verdeect-platform-client vitest.package.config.ts.
import { defineConfig } from 'vitest/config';
import { TEST_TIMEOUT_SCALE } from './src/testing/timeout-scale.js';

export default defineConfig({
    test: {
        include: ['test/package/**/*.spec.ts'],
        environment: 'node',
        // Тесты пакуют архив и ставят зависимости — параллельный запуск конфликтует на диске.
        fileParallelism: false,
        testTimeout: 300_000 * TEST_TIMEOUT_SCALE,
        // beforeAll ставит два проекта-потребителя из реестра — больше, чем у образца.
        hookTimeout: 600_000 * TEST_TIMEOUT_SCALE,
    },
});
