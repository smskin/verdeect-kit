// AC-1.2 (UC-1), AC-5.8: KitMessagingModule.forRoot требует pg только при outbox или dedupe: 'inbox' — проверка при сборке
// модуля, до прослушивания порта (prd.md §3.4, NFR-3). Подмена requirePeer — свой файл (isolate по умолчанию).
import { pgSchema } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as Peer from '../../../src/internal/peer.js';

const requirePeer = vi.hoisted(() => vi.fn());

vi.mock('../../../src/internal/peer.js', async (importOriginal) => {
    const original = await importOriginal<typeof Peer>();

    return {
        ...original,
        requirePeer: (library: string, subpath: string): void => {
            requirePeer(library, subpath);
            if (library === 'pg') {
                throw new Error(original.missingPeerMessage(library, subpath));
            }
        },
    };
});

const { defineEvent } = await import('../../../src/messaging/define-event.js');
const { KitMessagingModule } = await import('../../../src/messaging/kit-messaging.module.js');
const { createInboxTable, createOutboxTable } = await import('../../../src/messaging/tables.js');

const kit = pgSchema('kit');
const Created = defineEvent({
    type: 'kit.note.created',
    version: 1,
    subject: 'note',
    data: z.object({}),
});

describe('UC-1: /messaging и pg', () => {
    beforeEach(() => {
        requirePeer.mockClear();
    });

    it.each([
        ['outbox', { outbox: { table: createOutboxTable(kit), events: [Created] } }],
        ["dedupe 'inbox' (умолчание)", { subscriber: { inbox: createInboxTable(kit) } }],
    ])(
        'AC-1.2: forRoot с %s без pg — «@verdeect/kit/messaging требует pg …»',
        async (_name, options) => {
            await expect(
                KitMessagingModule.forRoot({ service: 'kit', ...options }),
            ).rejects.toThrow(
                '@verdeect/kit/messaging требует pg — добавьте в зависимости сервиса',
            );
            expect(requirePeer).toHaveBeenCalledWith('pg', 'messaging');
        },
    );

    it("AC-1.2: forRoot с subscriber {dedupe: 'none'} без pg не требует pg", async () => {
        const module = await KitMessagingModule.forRoot({
            service: 'kit',
            subscriber: { dedupe: 'none' },
        });

        expect(module.module).toBe(KitMessagingModule);
        expect(requirePeer).not.toHaveBeenCalledWith('pg', 'messaging');
    });
});
