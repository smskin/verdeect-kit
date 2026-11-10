// Unit-контур (уровень U, prd.md §5): test/unit/**/*.spec.ts без сети и Docker; тесты типов — *.test-d.ts.
// unplugin-swc пишет метаданные декораторов: без них Nest не разрешит DI в тестах (esbuild их не выдаёт).
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { TEST_TIMEOUT_SCALE } from './src/testing/timeout-scale.js';

export default defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
        include: ['test/unit/**/*.spec.ts'],
        environment: 'node',
        // Значения Vitest по умолчанию × TEST_TIMEOUT_SCALE.
        testTimeout: 5_000 * TEST_TIMEOUT_SCALE,
        hookTimeout: 10_000 * TEST_TIMEOUT_SCALE,
        restoreMocks: true,
        typecheck: {
            enabled: true,
            include: ['test/unit/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
        },
    },
});
