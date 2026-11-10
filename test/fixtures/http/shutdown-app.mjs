// Дочерний процесс AC-3.9 (UC-8; KT-15 п. 1): сервис на bootstrapService из собранного dist, остановка по SIGTERM.
// Аргументы: режим (plain — GET /slow 1500 мс; sse — ещё GET /stream, поток закрывает участник шага 2 сервиса) и каталог
// dist. Декораторы применяются функциями: в .mjs нет emitDecoratorMetadata, внедрение задаётся явно Inject(...).
// Порты — в строке лога «сервис слушает» (stdout).
import 'reflect-metadata';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller, Get, Inject, Injectable, Module, Res } from '@nestjs/common';

const [mode, distDir] = process.argv.slice(2);
const load = (subpath) => import(pathToFileURL(join(distDir, subpath, 'index.js')).href);
const [{ bootstrapService }, { defineEnv, envBase, KitConfigModule }, { KitLifecycle }] =
    await Promise.all([load('http'), load('config'), load('observability')]);

const env = defineEnv({ ...envBase });

class SseService {
    constructor(lifecycle) {
        this.lifecycle = lifecycle;
        this.streams = new Set();
    }

    onModuleInit() {
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

await bootstrapService({ module: AppModule, service: 'shutdown-app', env });
