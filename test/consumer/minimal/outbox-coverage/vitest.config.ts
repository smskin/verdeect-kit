// Прогон покрытия outbox потребителя (AC-5.13): CompanyArchived без успешного expectOutbox — teardown при
// KIT_OUTBOX_COVERAGE=1 падает со списком; без переменной — не падает.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['outbox-coverage/*.spec.ts'],
        globalSetup: ['./outbox-coverage/global-setup.ts'],
        testTimeout: 120_000,
        hookTimeout: 180_000,
    },
});
