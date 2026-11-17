// Образы тестового контура (prd.md §3.8 v1.35, E1); эталон — O test/support/images.ts, mailpit — I global-setup.ts.
// Ещё и подпуть @verdeect/kit/testing/images без условия development (AC-9.6): файл без импортов.

/** Образы тестов и compose сервисов (§3.8); мажорная смена образа — мажор пакета (G14). */
export const TEST_IMAGES = {
    postgres: 'postgres:17.11-alpine3.24',
    redis: 'redis:7.4.11-alpine',
    rabbitmq: 'rabbitmq:4.3.6-management-alpine',
    mailpit: 'axllent/mailpit:v1.31.6',
    minio: 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z',
} as const;
