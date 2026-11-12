// AC-5.15 (UC-5): KitMessagingModule.forRoot — событие tenant: 'none' при NOT NULL tenant outbox → отказ запуска
// MESSAGING_TENANT_NOT_NULLABLE; согласованность опций и таблиц (prd.md §3.4; П1). Таблицы — без БД.
import { pgSchema } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../../../src/messaging/define-event.js';
import { MessagingStartupError } from '../../../src/messaging/errors.js';
import { KitMessagingModule } from '../../../src/messaging/kit-messaging.module.js';
import { createInboxTable, createOutboxTable } from '../../../src/messaging/tables.js';

const kitnn = pgSchema('kitnn');
const data = z.object({});
const UserSeen = defineEvent({
    type: 'kitnn.user.seen',
    version: 1,
    subject: 'user',
    tenant: 'none',
    data,
});
const NoteCreated = defineEvent({ type: 'kitnn.note.created', version: 1, subject: 'note', data });

describe('UC-5: опции outbox', () => {
    it("AC-5.15: событие 'none' при createOutboxTable({tenantNullable: false}) — отказ forRoot MESSAGING_TENANT_NOT_NULLABLE, details {event, table}, текст называет tenantNullable: true", async () => {
        const error: unknown = await KitMessagingModule.forRoot({
            service: 'kitnn',
            outbox: { table: createOutboxTable(kitnn), events: [NoteCreated, UserSeen] },
        }).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(MessagingStartupError);
        const failure = error as MessagingStartupError;
        expect(failure.startupCode).toBe('MESSAGING_TENANT_NOT_NULLABLE');
        expect(failure.startupDetails()).toEqual({
            event: 'kitnn.user.seen',
            table: 'kitnn.outbox',
        });
        expect(failure.message).toContain('tenantNullable: true');
    });

    it('AC-5.15: то же событие при tenantNullable: true — forRoot собирается', async () => {
        const module = await KitMessagingModule.forRoot({
            service: 'kitnn',
            outbox: {
                table: createOutboxTable(kitnn, { tenantNullable: true }),
                events: [NoteCreated, UserSeen],
            },
        });

        expect(module.module).toBe(KitMessagingModule);
    });

    it("§3.4 v1.25: inbox при dedupe: 'none' модуля — собирается (для обработчиков с {dedupe: 'inbox'})", async () => {
        const module = await KitMessagingModule.forRoot({
            service: 'kitnn',
            subscriber: { dedupe: 'none', inbox: createInboxTable(kitnn) },
        });

        expect(module.module).toBe(KitMessagingModule);
    });

    it('§3.4: dedupe inbox без таблицы, таблицы разных схем, дубликат события → TypeError', async () => {
        await expect(
            KitMessagingModule.forRoot({ service: 'kitnn', subscriber: {} }),
        ).rejects.toThrow(/требует inbox/);
        await expect(
            KitMessagingModule.forRoot({
                service: 'kitnn',
                outbox: { table: createOutboxTable(kitnn), events: [NoteCreated] },
                subscriber: { inbox: createInboxTable(pgSchema('other')) },
            }),
        ).rejects.toThrow(/одной схемы/);
        await expect(
            KitMessagingModule.forRoot({
                service: 'kitnn',
                outbox: { table: createOutboxTable(kitnn), events: [NoteCreated, NoteCreated] },
            }),
        ).rejects.toThrow(/указано дважды/);
    });

    it("§3.4: outbox + subscriber {dedupe: 'none'} — собирается", async () => {
        const module = await KitMessagingModule.forRoot({
            service: 'kitnn',
            outbox: { table: createOutboxTable(kitnn), events: [NoteCreated] },
            subscriber: { dedupe: 'none' },
        });

        expect(module.module).toBe(KitMessagingModule);
    });
});
