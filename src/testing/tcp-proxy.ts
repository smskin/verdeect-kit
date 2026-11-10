// TCP-прокси для обрывов и задержек в тестах (prd.md §3.8, E1); эталон — O test/support/tcp-proxy.ts (029c25c).
// Без BrokerState/brokerReconnected и waitFor (только для брокера, при необходимости — E5).
// break() рвёт все соединения и перестаёт слушать, restore() — снова слушает тот же порт. blackhole() — потеря пакетов:
// рвёт текущие соединения, новые принимает, но ничего не передаёт. blackholeOn(pattern) — обрыв в момент запроса.
// delayOn(pattern, ms, count) — пакет клиента с совпадением уходит на сервер через ms (первые count раз); действует на
// соединения, принятые после вызова. freeze() — соединения остаются открытыми, но байты больше не пересылаются.
import { createServer, connect as tcpConnect, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/** Порт цели по схеме URL, если порт не указан. */
const DEFAULT_PORTS: Record<string, number> = {
    'postgres:': 5432,
    'postgresql:': 5432,
    'amqp:': 5672,
    'redis:': 6379,
    'http:': 80,
};

/** TCP-прокси с постоянным локальным портом на 127.0.0.1 (§3.8). */
export class TcpProxy {
    private server: Server | null = null;
    private readonly sockets = new Set<Socket>();
    /** Пары клиент → upstream с пересылкой (для freeze). */
    private readonly links = new Set<readonly [Socket, Socket]>();
    private port = 0;
    private blackholed = false;
    private trigger: RegExp | null = null;
    private delay: { pattern: RegExp; ms: number; left: number } | null = null;
    private readonly target: URL;

    /** upstreamUrl — URL цели с портом или схемой из DEFAULT_PORTS. */
    constructor(upstreamUrl: string) {
        this.target = new URL(upstreamUrl);
    }

    /** Исходный URL с хостом и портом прокси (учётные данные — как у исходного). */
    get url(): string {
        const url = new URL(this.target.href);
        url.hostname = '127.0.0.1';
        url.port = String(this.port);

        return url.href;
    }

    /** Начать слушать (порт выбирает ОС при первом запуске). */
    async start(): Promise<this> {
        await this.listen(this.port);

        return this;
    }

    /** Разорвать все соединения и перестать слушать; новые соединения отклоняются. */
    async break(): Promise<void> {
        const server = this.server;
        this.server = null;
        this.destroySockets();
        if (server !== null) {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    }

    /** Потеря пакетов: соединение устанавливается, но ответа нет (не «connection refused»). */
    blackhole(): void {
        this.blackholed = true;
        this.destroySockets();
    }

    /** Перестать пересылать байты, не закрывая соединений. */
    freeze(): void {
        this.blackholed = true;
        for (const [client, upstream] of this.links) {
            client.unpipe(upstream);
            upstream.unpipe(client);
        }
        this.links.clear();
    }

    /** blackhole() в момент, когда клиент отправит пакет, содержащий pattern (один раз). */
    blackholeOn(pattern: RegExp): void {
        this.trigger = pattern;
    }

    /**
     * Задержать пакеты клиента с совпадением на ms (первые count раз); для соединений после вызова:
     * режим пересылки выбирается при приёме соединения, уже открытые соединения не меняются.
     */
    delayOn(pattern: RegExp, ms: number, count = 1): void {
        this.delay = { pattern, ms, left: count };
    }

    /** Снять blackhole и обрыв, снова слушать тот же порт. */
    async restore(): Promise<void> {
        this.blackholed = false;
        this.trigger = null;
        if (this.server === null) {
            await this.listen(this.port);
        }
    }

    /** Закрыть прокси и освободить порт. */
    async close(): Promise<void> {
        await this.break();
    }

    private delayFor(chunk: Buffer): number {
        const rule = this.delay;
        if (rule === null || rule.left <= 0 || !rule.pattern.test(chunk.toString('latin1'))) {
            return 0;
        }
        rule.left -= 1;

        return rule.ms;
    }

    private destroySockets(): void {
        for (const socket of this.sockets) {
            socket.destroy();
        }
        this.sockets.clear();
        this.links.clear();
    }

    private async listen(port: number): Promise<void> {
        const upstreamPort = Number(this.target.port) || (DEFAULT_PORTS[this.target.protocol] ?? 0);
        const server = createServer((client) => {
            if (this.blackholed) {
                this.sockets.add(client);
                client.on('error', () => client.destroy());

                return;
            }
            const upstream = tcpConnect(upstreamPort, this.target.hostname);
            this.sockets.add(client);
            this.sockets.add(upstream);
            const link = [client, upstream] as const;
            this.links.add(link);
            if (this.delay === null) {
                client.pipe(upstream).pipe(client);
            } else {
                // Ручная пересылка в исходном порядке: задержанный пакет держит и следующие за ним.
                upstream.pipe(client);
                let queue = Promise.resolve();
                client.on('data', (chunk: Buffer) => {
                    const ms = this.delayFor(chunk);
                    queue = queue.then(async () => {
                        if (ms > 0) {
                            await new Promise((resolve) => setTimeout(resolve, ms));
                        }
                        if (this.links.has(link) && !upstream.destroyed) {
                            upstream.write(chunk);
                        }
                    });
                });
            }
            // pipe уже передал пакет: сокеты закрываются синхронно, до ответа сервера.
            client.on('data', (chunk: Buffer) => {
                if (this.trigger !== null && this.trigger.test(chunk.toString('latin1'))) {
                    this.trigger = null;
                    this.blackhole();
                }
            });
            const drop = (): void => {
                client.destroy();
                upstream.destroy();
                this.sockets.delete(client);
                this.sockets.delete(upstream);
                this.links.delete(link);
            };
            client.on('error', drop).on('close', drop);
            upstream.on('error', drop).on('close', drop);
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => resolve());
        });
        this.port = (server.address() as AddressInfo).port;
        this.server = server;
    }
}

/** Запущенный TCP-прокси к target (URL с портом или схемой из DEFAULT_PORTS). */
export async function tcpProxy(target: string): Promise<TcpProxy> {
    return new TcpProxy(target).start();
}
