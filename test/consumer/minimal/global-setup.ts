// globalSetup потребителя (AC-9.1, AC-3.8, AC-4.18, AC-5.13, AC-5.18): сборка сервиса tsc (dist/service), PostgreSQL и
// RabbitMQ из TEST_IMAGES через startTestStack пакета — prepareDatabase, миграции drizzle/ (журнал consumer.__migrations),
// definitions.json и vhost на воркер; Redis с aclfile пользователя consumer (E8); outboxEvents — покрытие при KIT_OUTBOX_COVERAGE=1. События — динамический импорт
// после сборки: статический import поднялся бы до tsc и упал бы на чистом checkout без dist.
import { startTestStack } from '@verdeect/kit/testing';
import { buildService } from './build-service.js';

buildService();
// Адрес — не литерал: tsc потребителя (types-check) не ищет dist до сборки; тип — из исходника.
const events = new URL('./dist/service/events.js', import.meta.url).href;
const { PUBLISHED_EVENTS } = (await import(events)) as typeof import('./src/service/events.js');

export default startTestStack({
    service: 'consumer',
    postgres: true,
    rabbitmq: true,
    redis: true,
    migrations: 'drizzle',
    outboxEvents: PUBLISHED_EVENTS,
});
