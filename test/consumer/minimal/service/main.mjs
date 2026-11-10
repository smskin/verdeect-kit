// Процесс сервиса-потребителя (AC-9.1, часть E2; prd.md §3.2): окружение, логгер, /health и /metrics на METRICS_PORT,
// остановка по SIGTERM через KitLifecycle. Без HTTP-приложения: bootstrapService и createHttpApp — этап E3, до него
// запасной логгер отказа окружения строит сам потребитель. Порт метрик печатается первой строкой stdout.
import { connect } from 'node:net';
import { defineEnv, envBase, envDatabase, parseEnv } from '@verdeect/kit/config';
import {
    createLoggerOptions,
    failStartup,
    HealthRegistry,
    KitLifecycle,
    kitMetrics,
    MetricsServer,
} from '@verdeect/kit/observability';
import { pino } from 'pino';

/** TCP-проба PostgreSQL. */
function tcpProbe(url) {
    const { hostname, port } = new URL(url);

    return () =>
        new Promise((resolve) => {
            const socket = connect({ host: hostname, port: Number(port) });
            socket.setTimeout(1000);
            socket.once('connect', () => {
                socket.end();
                resolve(true);
            });
            socket.once('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            socket.once('error', () => resolve(false));
        });
}

let env;
try {
    env = parseEnv(defineEnv({ ...envBase, ...envDatabase }), process.env);
} catch (error) {
    await failStartup(
        error,
        pino({ level: 'info', base: { service: 'consumer' } }, process.stderr),
    );
}

const logger = pino(...createLoggerOptions({ service: 'consumer', entry: 'cli', env }).pinoHttp);
const health = new HealthRegistry({ logger });
health.register('database', tcpProbe(env.DATABASE_URL), { critical: true });
const metrics = kitMetrics({ service: 'consumer' });
const server = new MetricsServer({
    port: env.METRICS_PORT,
    registry: metrics.registry,
    health,
    logger,
});
const lifecycle = new KitLifecycle({ logger, health, env });
lifecycle.register(
    { name: 'worker', stop: () => logger.info('участник шага 3 остановлен') },
    { step: 3 },
);
lifecycle.register({ name: 'metrics', stop: () => server.close() }, { step: 5 });

try {
    await server.listen();
} catch (error) {
    await failStartup(error, logger);
}
lifecycle.listen();
process.stdout.write(`${JSON.stringify({ metricsPort: server.address() })}\n`);
