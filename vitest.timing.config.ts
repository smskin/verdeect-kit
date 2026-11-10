// Тайминговый контур (уровень T, prd.md §5): test/timing/**/*.spec.ts — только на тихой машине; globalSetup — timingGuard.
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { TEST_TIMEOUT_SCALE } from './src/testing/timeout-scale.js';

export default defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
        include: ['test/timing/**/*.spec.ts'],
        environment: 'node',
        globalSetup: ['test/timing/global-setup.ts'],
        fileParallelism: false,
        testTimeout: 60_000 * TEST_TIMEOUT_SCALE,
        hookTimeout: 60_000 * TEST_TIMEOUT_SCALE,
    },
});
