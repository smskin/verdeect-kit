// expectOutbox, assertOutboxCoverage (prd.md §3.8 E5, GAP-2, UC-14, AC-5.13; П16). Покрытие — файлы воркеров
// w<VITEST_POOL_ID>.txt в каталоге прогона startTestStack({outboxEvents}); teardown при KIT_OUTBOX_COVERAGE=1. vitest —
// loadPeer внутри функций: /testing импортируется без vitest; /messaging не импортируется (без amqplib).
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type * as Vitest from 'vitest';
import type { z } from 'zod';
import type { DbTx } from '../database/db.js';
import { OUTBOX_TABLE } from '../internal/outbox-policy.js';
import { loadPeer } from '../internal/peer.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import type { KitEvent } from '../messaging/define-event.js';

let coverageDir: string | undefined;
let workerCoverageDir: string | undefined;

/** @internal Каталог прогона в процессе globalSetup (startTestStack). */
export function setCoverageDir(dir: string | undefined): void {
    coverageDir = dir;
}

/** @internal Каталог покрытия воркера вместо `inject('kitOutboxCoverageDir')` (тесты пакета). */
export function setWorkerCoverageDir(dir: string | undefined): void {
    workerCoverageDir = dir;
}

/** Ключ покрытия события. */
function coverageKey(event: KitEvent): string {
    return `${event.type}.v${event.version}`;
}

/**
 * Проверяет запись события в **текущей** транзакции `tx` (строки других транзакций не учитываются): строка
 * `<schema>.outbox` с типом и версией события есть, `data` проходит схему события и (если задано) совпадает с
 * `expected.data` (`toMatchObject`), `subjectId` (если задан) совпадает. После успешной проверки ключ `<type>.v<version>`
 * дописывается в файл покрытия воркера (`assertOutboxCoverage`).
 * @throws утверждение vitest — строки нет, `data` не по схеме или не совпала.
 * @throws {TypeError} `startTestStack` без `postgres`.
 */
export async function expectOutbox<E extends KitEvent>(
    tx: DbTx,
    event: E,
    expected: {
        readonly subjectId?: string;
        readonly data?: Partial<z.input<E['data']>>;
    } = {},
): Promise<void> {
    const { expect, inject } = await loadPeer<typeof Vitest>('vitest', 'testing');
    const schema = inject('kitDatabaseService');
    if (schema === undefined) {
        throw new TypeError('expectOutbox: startTestStack запущен без postgres');
    }
    const key = coverageKey(event);
    const table = sql.raw(`${quoteIdentifier(schema)}.${quoteIdentifier(OUTBOX_TABLE)}`);
    const subject =
        expected.subjectId === undefined ? sql`` : sql` and subject_id = ${expected.subjectId}`;
    const { rows } = await tx.execute<{ id: string; subject_id: string; data: unknown }>(
        sql`select id, subject_id, data from ${table}
            where type = ${event.type} and version = ${event.version}
            and xmin = pg_current_xact_id()::xid${subject} order by seq`,
    );
    const where = expected.subjectId === undefined ? '' : ` (subjectId ${expected.subjectId})`;
    expect(rows, `expectOutbox: нет строки ${key}${where} в транзакции`).not.toHaveLength(0);
    for (const row of rows) {
        const parsed = event.data.safeParse(row.data);
        if (!parsed.success) {
            const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)');
            expect.fail(
                `expectOutbox: data строки ${row.id} (${key}) не по схеме: ${paths.join(', ')}`,
            );
        }
    }
    if (expected.data !== undefined) {
        const matching = rows.some((row) => {
            try {
                expect(row.data).toMatchObject(expected.data as object);

                return true;
            } catch {
                return false;
            }
        });
        if (!matching) {
            expect(rows[0]?.data, `expectOutbox: data ${key} не совпала`).toMatchObject(
                expected.data as object,
            );
        }
    }
    const dir = workerCoverageDir ?? inject('kitOutboxCoverageDir');
    if (dir !== undefined) {
        appendFileSync(join(dir, `w${process.env.VITEST_POOL_ID ?? '0'}.txt`), `${key}\n`);
    }
}

/**
 * Падает со списком событий без успешного `expectOutbox` за прогон (GAP-2): объединяет файлы воркеров каталога
 * прогона. Вызывает teardown `startTestStack({outboxEvents})` при `KIT_OUTBOX_COVERAGE=1`.
 * @throws {TypeError} вызов вне teardown `startTestStack({outboxEvents})`.
 * @throws {Error} «assertOutboxCoverage: события без успешного expectOutbox: <ключи>».
 */
export function assertOutboxCoverage(events: readonly KitEvent[]): void {
    const dir = coverageDir;
    if (dir === undefined) {
        throw new TypeError(
            'assertOutboxCoverage: вызывается из teardown startTestStack({outboxEvents})',
        );
    }
    const covered = new Set<string>();
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.txt'))) {
        for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
            if (line !== '') {
                covered.add(line);
            }
        }
    }
    const missing = [...new Set(events.map(coverageKey))].filter((key) => !covered.has(key));
    if (missing.length > 0) {
        const message = `assertOutboxCoverage: события без успешного expectOutbox: ${missing.join(', ')}`;
        // Vite теряет текст ошибок globalSetup: сообщение — в stderr до throw.
        process.stderr.write(`${message}\n`);
        throw new Error(message);
    }
}
