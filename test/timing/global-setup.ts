// globalSetup уровня T (prd.md §3.8; П19 плана E5): сторож замеров времени пакета, затем стек — PostgreSQL (БД kit,
// фикстура) и RabbitMQ с vhost на воркер (AC-5.3, AC-5.4, AC-5.11, AC-5.16), Redis с aclfile kit (AC-8.2).
import type { TestProject } from 'vitest/node';
import { startTestStack } from '../../src/testing/start-test-stack.js';
import { timingGuard } from '../../src/testing/timing-guard.js';

const stack = startTestStack({
    service: 'kit',
    postgres: true,
    rabbitmq: true,
    redis: true,
    migrations: 'test/fixtures/database/migrations',
});

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
    await timingGuard();

    return stack(project);
}
