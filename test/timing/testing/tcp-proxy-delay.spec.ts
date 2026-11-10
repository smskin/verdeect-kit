// tcpProxy.delayOn (prd.md §3.8, E1; уровень T — только тихая машина); эталон — O test/support/tcp-proxy.ts.
// delayOn действует на соединения, открытые после вызова: режим пересылки выбирается при приёме соединения.
import { once } from 'node:events';
import { connect, createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';

let echo: Server;
let proxy: TcpProxy;

beforeEach(async () => {
    echo = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', () => resolve()));
    proxy = await tcpProxy(`http://127.0.0.1:${(echo.address() as AddressInfo).port}`);
});

afterEach(async () => {
    await proxy.close();
    echo.close();
});

async function open(): Promise<Socket> {
    const socket = connect(Number(new URL(proxy.url).port), '127.0.0.1');
    await once(socket, 'connect');

    return socket;
}

/** Время от отправки ping до ответа, мс. */
async function roundTrip(socket: Socket): Promise<number> {
    const started = performance.now();
    socket.write('ping');
    await once(socket, 'data');

    return performance.now() - started;
}

describe('§3.8 (T): задержки tcpProxy', () => {
    it('§3.8 (T): tcpProxy.delayOn задерживает совпавший пакет не меньше заданного', async () => {
        proxy.delayOn(/ping/, 300);
        const socket = await open();

        const elapsed = await roundTrip(socket);

        expect(elapsed).toBeGreaterThanOrEqual(300);
        expect(elapsed).toBeLessThan(300 + 1000 * TEST_TIMEOUT_SCALE);
        socket.destroy();
    });

    it('§3.8 (T): после count задержек трафик идёт без задержки', async () => {
        proxy.delayOn(/ping/, 300, 1);
        const socket = await open();

        await roundTrip(socket);
        const second = await roundTrip(socket);

        expect(second).toBeLessThan(100 * TEST_TIMEOUT_SCALE);
        socket.destroy();
    });
});
