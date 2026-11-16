// Дочерний процесс AC-3.9 (UC-8; KT-15 п. 1): сервис на bootstrapService из собранного dist, остановка по SIGTERM.
// Аргументы: режим (plain — GET /slow 1500 мс; sse — ещё GET /stream, поток закрывает участник шага 2 сервиса) и каталог
// dist. Декораторы применяются функциями: в .mjs нет emitDecoratorMetadata, внедрение задаётся явно Inject(...).
// Порты — в строке лога «сервис слушает» (stdout). Режим ws (BFF-77, prd.md §3.2 v1.30): WebSocket /ws вручную (рукопожатие и
// кадры закрытия без зависимостей); server.close подменён по образцу @fastify/http-proxy — клиенты получают 1005; участник
// шага 2 сервиса закрывает сокеты кодом 1001 и пишет в stdout строку «ws: 1001 отправлен» с server.listening. Подмена
// server.close первой пишет в stdout строку «http: server.close» (до исходного close): тест ждёт её событием, без опроса.
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller, Get, Inject, Injectable, Module, Res } from '@nestjs/common';

const [mode, distDir] = process.argv.slice(2);
const load = (subpath) => import(pathToFileURL(join(distDir, subpath, 'index.js')).href);
const [{ bootstrapService }, { defineEnv, envBase, KitConfigModule }, { KitLifecycle }] =
    await Promise.all([load('http'), load('config'), load('observability')]);

const env = defineEnv({ ...envBase });
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsSockets = new Set();
let httpServer = null;

/** Режим ws: рукопожатие /ws и подмена server.close (до регистрации маршрутов и listen). */
function configureWs(fastify) {
    httpServer = fastify.server;
    httpServer.on('upgrade', (req, socket) => {
        if (req.url !== '/ws') {
            socket.destroy();
            return;
        }
        const accept = createHash('sha1')
            .update(`${req.headers['sec-websocket-key']}${WS_GUID}`)
            .digest('base64');
        socket.on('error', () => undefined);
        socket.once('close', () => wsSockets.delete(socket));
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        wsSockets.add(socket);
    });
    // Как @fastify/http-proxy 11.6.5 (index.js:511–522): server.close закрывает WS-клиентов пустым кадром закрытия (1005).
    const close = httpServer.close;
    httpServer.close = function (cb) {
        process.stdout.write(
            `${JSON.stringify({ msg: 'http: server.close', listening: this.listening })}\n`,
        );
        for (const socket of wsSockets) {
            if (!socket.destroyed && !socket.writableEnded) {
                socket.write(Buffer.from([0x88, 0x00]));
                socket.end();
            }
        }
        return close.call(this, cb);
    };
}

/** Участник шага 2 режима ws: кадр закрытия 1001 каждому сокету, ожидание закрытия сокета. */
function closeWs() {
    const open = [...wsSockets].filter((socket) => !socket.destroyed && !socket.writableEnded);
    return Promise.all(
        open.map(
            (socket) =>
                new Promise((resolve) => {
                    socket.once('close', resolve);
                    // Ответный кадр закрытия клиента — конец сокета с нашей стороны.
                    socket.once('data', () => socket.end());
                    process.stdout.write(
                        `${JSON.stringify({ msg: 'ws: 1001 отправлен', listening: httpServer.listening })}\n`,
                    );
                    socket.write(Buffer.from([0x88, 0x02, 0x03, 0xe9]));
                }),
        ),
    );
}

class SseService {
    constructor(lifecycle) {
        this.lifecycle = lifecycle;
        this.streams = new Set();
    }

    onModuleInit() {
        if (mode === 'ws') {
            // Участник шага 2 сервиса («onStopAccepting», §3.2 v1.30): WebSocket закрывается своим кодом 1001.
            this.lifecycle.register({ name: 'ws', stop: closeWs }, { step: 2 });
            return;
        }
        if (mode !== 'sse') {
            return;
        }
        // Участник шага 2 сервиса («onStopAccepting», §3.2): поток закрывается вызовом raw.end().
        this.lifecycle.register(
            { name: 'sse', stop: () => this.streams.forEach((raw) => raw.end()) },
            { step: 2 },
        );
    }
}
Injectable()(SseService);
Inject(KitLifecycle)(SseService, undefined, 0);

class AppController {
    constructor(sse) {
        this.sse = sse;
    }

    async slow() {
        await new Promise((resolve) => setTimeout(resolve, 1500));

        return { ok: true };
    }

    stream(reply) {
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
        reply.raw.write(': open\n\n');
        this.sse.streams.add(reply.raw);
    }
}
Controller()(AppController);
Inject(SseService)(AppController, undefined, 0);
for (const [name, path] of [
    ['slow', 'slow'],
    ['stream', 'stream'],
]) {
    Get(path)(AppController.prototype, name, Object.getOwnPropertyDescriptor(AppController.prototype, name));
}
Res()(AppController.prototype, 'stream', 0);

class AppModule {}
Module({
    imports: [KitConfigModule.forRoot({ schema: env })],
    controllers: [AppController],
    providers: [SseService],
})(AppModule);

await bootstrapService({
    module: AppModule,
    service: 'shutdown-app',
    env,
    ...(mode === 'ws' ? { http: { configureFastify: configureWs } } : {}),
});
