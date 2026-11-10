// tcpProxy (prd.md §3.8, E1) на локальном эхо-сервере, без Docker; эталон — O test/support/tcp-proxy.ts.
import { once } from 'node:events';
import { connect, createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';

let echo: Server;
let proxy: TcpProxy;

function portOf(url: string): number {
    return Number(new URL(url).port);
}

async function open(url: string): Promise<Socket> {
    const socket = connect(portOf(url), '127.0.0.1');
    await once(socket, 'connect');

    return socket;
}

/** Первый ответ сокета или null, если за ms ничего не пришло. */
function reply(socket: Socket, ms: number): Promise<string | null> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        socket.once('data', (chunk: Buffer) => {
            clearTimeout(timer);
            resolve(chunk.toString());
        });
    });
}

beforeEach(async () => {
    echo = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', () => resolve()));
    proxy = await tcpProxy(`http://127.0.0.1:${(echo.address() as AddressInfo).port}`);
});

afterEach(async () => {
    await proxy.close();
    echo.close();
});

describe('§3.8: tcpProxy', () => {
    it('§3.8: tcpProxy — данные проходят к цели и обратно', async () => {
        const socket = await open(proxy.url);
        socket.write('ping');

        expect(await reply(socket, 1000)).toBe('ping');
        socket.destroy();
    });

    it('§3.8: break → новое соединение отклоняется; restore → снова проходит на том же порту', async () => {
        const url = proxy.url;
        await proxy.break();

        const refused = connect(portOf(url), '127.0.0.1');
        const [error] = (await once(refused, 'error')) as [NodeJS.ErrnoException];
        expect(error.code).toBe('ECONNREFUSED');

        await proxy.restore();
        expect(proxy.url).toBe(url);
        const socket = await open(url);
        socket.write('again');
        expect(await reply(socket, 1000)).toBe('again');
        socket.destroy();
    });

    it('§3.8: blackhole — соединение принято, ответа нет', async () => {
        proxy.blackhole();
        const socket = await open(proxy.url);
        socket.write('ping');

        expect(await reply(socket, 200)).toBeNull();
        socket.destroy();
    });

    it('§3.8: close освобождает порт', async () => {
        const port = portOf(proxy.url);
        await proxy.close();

        const server = createServer();
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => resolve());
        });
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
});
