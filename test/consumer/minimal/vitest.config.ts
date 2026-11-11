// Тесты проекта-потребителя (AC-9.1) на упакованном архиве @verdeect/kit.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.spec.ts'],
        globalSetup: ['./global-setup.ts'],
        testTimeout: 120_000,
        hookTimeout: 180_000,
        // relay messaging.spec.ts и процесса observability.spec.ts опрашивают один consumer.outbox.
        fileParallelism: false,
    },
});
