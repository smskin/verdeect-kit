// Тесты проекта-потребителя (AC-9.1) на упакованном архиве @verdeect/kit; тайм-ауты × TEST_TIMEOUT_SCALE из подпути
// без условия development (AC-9.6).
import { TEST_TIMEOUT_SCALE } from '@verdeect/kit/testing/timeout-scale';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.spec.ts'],
        globalSetup: ['./global-setup.ts'],
        testTimeout: 120_000 * TEST_TIMEOUT_SCALE,
        hookTimeout: 180_000 * TEST_TIMEOUT_SCALE,
        // relay messaging.spec.ts и процесса observability.spec.ts опрашивают один consumer.outbox.
        fileParallelism: false,
    },
});
