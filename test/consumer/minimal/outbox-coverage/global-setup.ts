// globalSetup прогона покрытия (AC-5.13): та же сборка сервиса, PostgreSQL без RabbitMQ (покрытию брокер не нужен),
// outboxEvents — оба события сервиса.
import { startTestStack } from '@verdeect/kit/testing';
import { buildService } from '../build-service.js';

buildService();
// Адрес — не литерал: tsc потребителя не ищет dist до сборки; тип — из исходника.
const events = new URL('../dist/service/events.js', import.meta.url).href;
const { PUBLISHED_EVENTS } = (await import(events)) as typeof import('../src/service/events.js');

export default startTestStack({
    service: 'consumer',
    postgres: true,
    migrations: 'drizzle',
    outboxEvents: PUBLISHED_EVENTS,
});
