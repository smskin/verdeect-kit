// Дочерний процесс AC-2.10 (KT-10 п. 4): KitLifecycle из собранного dist, остановка по SIGTERM. Аргументы: режим
// (clean — без утечек, timer — оставленный setInterval, server — оставленный сервер node:net), каталог dist, срок мс.
// Событие GlitchTip — маркер {"sentry": code} в stderr (поддельный транспорт). Маркер {"signal":true} — прямо перед
// отправкой сигнала: от него родитель отсчитывает время до выхода.
import { createServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Sentry from '@sentry/nestjs';
import { pino } from 'pino';

const [mode, distDir, timeoutMs] = process.argv.slice(2);
const kit = await import(pathToFileURL(join(distDir, 'observability', 'index.js')).href);

Sentry.init({
    dsn: 'https://public@example.invalid/1',
    defaultIntegrations: false,
    integrations: [],
    transport: () =>
        Sentry.createTransport({ recordDroppedEvent: () => undefined }, async (request) => {
            const code = /"code":"([A-Z_]+)"/.exec(String(request.body))?.[1] ?? 'unknown';
            process.stderr.write(`${JSON.stringify({ sentry: code })}\n`);

            return { statusCode: 200 };
        }),
});

const logger = pino({ level: 'info', base: { service: 'kit-child', replica: 'child-1' } }, process.stderr);
const health = new kit.HealthRegistry({ logger });
const lifecycle = new kit.KitLifecycle({
    logger,
    health,
    env: { SHUTDOWN_TIMEOUT_MS: Number(timeoutMs), SHUTDOWN_DRAIN_MS: 0 },
});

lifecycle.register(
    {
        name: 'worker',
        async stop() {
            if (mode === 'timer') {
                setInterval(() => undefined, 1000);
            }
            if (mode === 'server') {
                await new Promise((resolve) => createServer().listen(0, resolve));
            }
        },
    },
    { step: 3 },
);
lifecycle.listen();

process.stderr.write(`${JSON.stringify({ signal: true })}\n`);
process.kill(process.pid, 'SIGTERM');
