// MetricsServer — /health и /metrics на METRICS_PORT (prd.md §3.2, AC-2.7, AC-2.8, UC-13). Эталон — O metrics-server.ts:
// node:http вне Nest, учёт inflight, query отбрасывается, /health — JSON с cache-control: no-store, /metrics —
// registry.metrics(), прочее — 404, закрытие closeAllConnections + close + ожидание inflight, address() для порта 0.
// По PRD и KT-10: без Nest-хуков (закрытие — участник шага 5 KitLifecycle), флаг остановки — в HealthRegistry, ошибка
// listen (EADDRINUSE) — отказ listen(), а не работа без метрик. Строк лога на запрос нет.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { Registry } from '@prometheus-io/client';
import type { HealthRegistry } from './health-registry.js';
import { sanitizeError } from './sanitize-error.js';
import { captureError } from './sentry.js';

const HEALTH_HEADERS = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
};
const UNAVAILABLE = JSON.stringify({ status: 'unavailable', checks: {} });

/** HTTP-сервер метрик и готовности; закрывается последним (шаг 5 `KitLifecycle`). */
export class MetricsServer {
    private readonly port: number;
    private readonly registry: Registry;
    private readonly health: HealthRegistry;
    private readonly logger: Logger;
    private server: Server | null = null;
    private closing: Promise<void> | null = null;
    /** Обработчики в работе: closeAllConnections рвёт сокет, но обработчик ещё может ждать пробу. */
    private readonly inflight = new Set<Promise<void>>();

    constructor(options: {
        readonly port: number;
        readonly registry: Registry;
        readonly health: HealthRegistry;
        readonly logger: Logger;
    }) {
        this.port = options.port;
        this.registry = options.registry;
        this.health = options.health;
        this.logger = options.logger;
    }

    /**
     * Начинает слушать `port` (0 — порт выбирает ОС); ошибка прослушивания — отказ (передать в `failStartup`).
     * После `close()` — ошибка разработчика: закрытый сервер не перезапускается.
     */
    async listen(): Promise<void> {
        if (this.closing !== null) {
            throw new Error('MetricsServer: listen() после close()');
        }
        const server = createServer((req, res) => {
            const handling = this.handle(req, res).finally(() => this.inflight.delete(handling));
            this.inflight.add(handling);
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(this.port, () => {
                server.off('error', reject);
                resolve();
            });
        });
        this.server = server;
        this.logger.info({ port: this.address() }, 'сервер метрик слушает');
    }

    /** Фактический порт; `null` — сервер не слушает. */
    address(): number | null {
        const address = this.server?.address();
        if (address === null || address === undefined || typeof address === 'string') {
            return null;
        }

        return address.port;
    }

    /** Закрывает сервер и ждёт обработчики в работе; идемпотентен. */
    close(): Promise<void> {
        this.closing ??= this.closeServer();

        return this.closing;
    }

    private async closeServer(): Promise<void> {
        const server = this.server;
        if (server === null) {
            return;
        }
        this.server = null;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await Promise.allSettled(this.inflight);
        this.logger.debug('сервер метрик закрыт');
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const path = (req.url ?? '').split('?', 1)[0];
        if (req.method === 'GET' && path === '/health') {
            await this.handleHealth(res);

            return;
        }
        if (req.method !== 'GET' || path !== '/metrics') {
            res.writeHead(404).end();

            return;
        }
        try {
            const body = await this.registry.metrics();
            res.writeHead(200, { 'content-type': this.registry.contentType }).end(body);
        } catch (error) {
            this.logger.error(
                { err: sanitizeError(error) },
                'сервер метрик: сбор метрик не удался',
            );
            captureError(error);
            res.writeHead(500).end();
        }
    }

    /** ok, degraded → 200; unavailable (в том числе с начала остановки) → 503. Тело — только статусы. */
    private async handleHealth(res: ServerResponse): Promise<void> {
        try {
            const report = await this.health.evaluate();
            res.writeHead(report.status === 'unavailable' ? 503 : 200, HEALTH_HEADERS).end(
                JSON.stringify(report),
            );
        } catch (error) {
            this.logger.error(
                { err: sanitizeError(error) },
                'сервер метрик: проверка здоровья не удалась',
            );
            captureError(error);
            res.writeHead(503, HEALTH_HEADERS).end(UNAVAILABLE);
        }
    }
}
