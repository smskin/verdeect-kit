// AC-5.22 (U; prd.md §3.4 v1.28): опция unknownVersion у KitSubscriber.on — 'skip' | 'dlq'; у onReplica опции нет.
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../../../src/messaging/define-event.js';
import type { KitSubscriber } from '../../../src/messaging/subscriber.js';

const NoteCreated = defineEvent({
    type: 'svc-a.note.created',
    version: 1,
    subject: 'note',
    data: z.object({ noteId: z.string() }),
});

declare const subscriber: KitSubscriber;
const handler = (): Promise<void> => Promise.resolve();

describe('UC-6: тип опции unknownVersion', () => {
    it("AC-5.22: on(E, h, {unknownVersion: 'dlq' | 'skip'}) компилируется", () => {
        expectTypeOf(subscriber.on(NoteCreated, handler, { unknownVersion: 'dlq' })).toBeVoid();
        expectTypeOf(subscriber.on(NoteCreated, handler, { unknownVersion: 'skip' })).toBeVoid();
    });

    it("AC-5.22: unknownVersion вне 'skip' | 'dlq' и у onReplica — ошибка типов", () => {
        // @ts-expect-error — значение вне 'skip' | 'dlq'.
        subscriber.on(NoteCreated, handler, { unknownVersion: 'drop' });
        // @ts-expect-error — у onReplica опции нет.
        subscriber.onReplica(NoteCreated, handler, { unknownVersion: 'dlq' });
    });
});
