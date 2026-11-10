// Образы тестового контура (prd.md §3.8, E1); эталон — O test/support/images.ts, mailpit — I global-setup.ts.

/** Образы тестов и compose сервисов (§3.8); мажорная смена образа — мажор пакета (G14). */
export const TEST_IMAGES = {
    postgres: 'postgres:17.11-alpine3.24',
    redis: 'redis:7.4.11-alpine',
    rabbitmq: 'rabbitmq:4.3.6-management-alpine',
    mailpit: 'axllent/mailpit:v1.31.6',
    minio: 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z',
} as const;

/** Репозиторий образа — часть до последнего `:` (`axllent/mailpit`); внутренний помощник правил §3.8. */
export function imageRepository(image: string): string {
    const colon = image.lastIndexOf(':');

    return colon === -1 ? image : image.slice(0, colon);
}
