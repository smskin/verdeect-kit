// AC-5.13 (prd.md §3.8 publishTestEvent, KT-24 п. 1): отказ createConfirmChannel после успешного connect закрывает
// соединение, повторные попытки не копят открытых соединений. amqplib подменён через loadPeer — свой файл.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as Peer from '../../../src/internal/peer.js';

interface FakeConnection extends EventEmitter {
    close: ReturnType<typeof vi.fn>;
    createConfirmChannel: ReturnType<typeof vi.fn>;
}

const connect = vi.hoisted(() => vi.fn());

vi.mock('../../../src/internal/peer.js', async (importOriginal) => {
    const original = await importOriginal<typeof Peer>();

    return {
        ...original,
        loadPeer: async (library: string, subpath: string): Promise<unknown> => {
            if (library === 'amqplib') {
                return { connect };
            }

            return original.loadPeer(library, subpath);
        },
    };
});

const { defineEvent } = await import('../../../src/messaging/define-event.js');
const { publishTestEvent, setTestEventsUrl } = await import('../../../src/testing/test-events.js');

const Pinged = defineEvent({
    type: 'kit.note.pinged',
    version: 1,
    subject: 'note',
    tenant: 'none',
    data: z.object({}),
});

function fakeConnection(createConfirmChannel: ReturnType<typeof vi.fn>): FakeConnection {
    const connection = new EventEmitter() as FakeConnection;
    connection.close = vi.fn().mockResolvedValue(undefined);
    connection.createConfirmChannel = createConfirmChannel;

    return connection;
}

function failingConnection(): FakeConnection {
    return fakeConnection(vi.fn().mockRejectedValue(new Error('channel')));
}

interface FakeChannel extends EventEmitter {
    publish: ReturnType<typeof vi.fn>;
    waitForConfirms: ReturnType<typeof vi.fn>;
}

function workingChannel(): FakeChannel {
    const created = new EventEmitter() as FakeChannel;
    created.publish = vi.fn();
    created.waitForConfirms = vi.fn().mockResolvedValue(undefined);

    return created;
}

describe('AC-5.13: publishTestEvent — открытие канала', () => {
    afterEach(() => {
        setTestEventsUrl(undefined);
        connect.mockReset();
    });

    it('AC-5.13: отказ createConfirmChannel после connect — соединение закрыто, ошибка проброшена', async () => {
        setTestEventsUrl('amqp://fake');
        const connection = failingConnection();
        connect.mockResolvedValueOnce(connection);

        await expect(publishTestEvent(Pinged, {})).rejects.toThrow('channel');
        expect(connection.close).toHaveBeenCalledTimes(1);
    });

    it('AC-5.13: три неудачных вызова подряд — три connect, каждое соединение закрыто, открытых не остаётся', async () => {
        setTestEventsUrl('amqp://fake');
        const connections = [failingConnection(), failingConnection(), failingConnection()];
        for (const connection of connections) {
            connect.mockResolvedValueOnce(connection);
        }

        for (let attempt = 0; attempt < connections.length; attempt += 1) {
            await expect(publishTestEvent(Pinged, {})).rejects.toThrow('channel');
        }

        expect(connect).toHaveBeenCalledTimes(3);
        for (const connection of connections) {
            expect(connection.close).toHaveBeenCalledTimes(1);
        }
    });

    it('AC-5.13: после неудач успешный канал переиспользуется', async () => {
        setTestEventsUrl('amqp://fake');
        connect.mockResolvedValueOnce(failingConnection());
        connect.mockResolvedValueOnce(failingConnection());
        connect.mockResolvedValueOnce(failingConnection());
        const created = workingChannel();
        const good = fakeConnection(vi.fn().mockResolvedValue(created));
        connect.mockResolvedValueOnce(good);

        for (let attempt = 0; attempt < 3; attempt += 1) {
            await expect(publishTestEvent(Pinged, {})).rejects.toThrow('channel');
        }
        connect.mockClear();
        await publishTestEvent(Pinged, {});
        await publishTestEvent(Pinged, {});

        expect(connect).toHaveBeenCalledTimes(1);
        expect(created.publish).toHaveBeenCalledTimes(2);
        expect(good.close).not.toHaveBeenCalled();
    });
});
