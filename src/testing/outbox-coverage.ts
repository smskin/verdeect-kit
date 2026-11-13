// expectOutbox, assertOutboxCoverage (prd.md §3.8 E5, GAP-2, UC-14, AC-5.13; П16). Покрытие — файлы воркеров
// w<VITEST_POOL_ID>.txt в каталоге прогона startTestStack({outboxEvents}); teardown при KIT_OUTBOX_COVERAGE=1. vitest —
// loadPeer внутри функций: /testing импортируется без vitest; /messaging не импортируется (без amqplib). v1.26 (AC-5.13):
// форма {app, traceId} — основной пул Db приложения (без kit-database.module.ts, KT-77).
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type * as Vitest from 'vitest';
import type { z } from 'zod';
import { Db, mainPoolOf, type DbTx } from '../database/db.js';
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

/** Ожидание `expectOutbox`: субъект и часть `data`. */
type ExpectedOutbox<E extends KitEvent> = {
    readonly subjectId?: string;
    readonly data?: Partial<z.input<E['data']>>;
};

/** Приложение и `traceId` use-case со своей транзакцией (форма `expectOutbox({app, traceId})`). */
export interface KitOutboxTrace {
    /** Приложение сервиса: строки читаются основным пулом его `Db`. */
    readonly app: Pick<INestApplicationContext, 'get'>;
    /** `traceId` контекста транзакции use-case (`DbContext.traceId`); непустой. */
    readonly traceId: string;
}

type OutboxRow = { id: string; subject_id: string; data: unknown };

/**
 * Проверяет запись события в **текущей** транзакции `tx` (строки других транзакций не учитываются): строка
 * `<schema>.outbox` с типом и версией события есть, `data` проходит схему события и (если задано) совпадает с
 * `expected.data` (`toMatchObject`), `subjectId` (если задан) совпадает. После успешной проверки ключ `<type>.v<version>`
 * дописывается в файл покрытия воркера (`assertOutboxCoverage`).
 * @throws утверждение vitest — строки нет, `data` не по схеме или не совпала.
 * @throws {TypeError} `startTestStack` без `postgres`.
 */
export function expectOutbox<E extends KitEvent>(
    tx: DbTx,
    event: E,
    expected?: ExpectedOutbox<E>,
): Promise<void>;
/**
 * Проверяет строку события use-case со своей транзакцией — после `COMMIT`: строка `<schema>.outbox` с типом, версией
 * и `trace_id = traceId` (строки с другим `traceId` не учитываются) читается основным пулом приложения в короткой
 * транзакции с пустым тенантом (исключение строгой модели для outbox). Проверки `data`, `subjectId` и запись покрытия —
 * как у формы с `tx`.
 * @throws утверждение vitest — строки нет, `data` не по схеме или не совпала.
 * @throws {TypeError} пустой `traceId` или `startTestStack` без `postgres`.
 */
export function expectOutbox<E extends KitEvent>(
    trace: KitOutboxTrace,
    event: E,
    expected?: ExpectedOutbox<E>,
): Promise<void>;
export async function expectOutbox<E extends KitEvent>(
    target: DbTx | KitOutboxTrace,
    event: E,
    expected: ExpectedOutbox<E> = {},
): Promise<void> {
    const vitest = await loadPeer<typeof Vitest>('vitest', 'testing');
    const schema = vitest.inject('kitDatabaseService');
    if (schema === undefined) {
        throw new TypeError('expectOutbox: startTestStack запущен без postgres');
    }
    const table = `${quoteIdentifier(schema)}.${quoteIdentifier(OUTBOX_TABLE)}`;
    const trace = isTrace(target);
    const rows = trace
        ? await committedRows(target, table, event, expected.subjectId)
        : await transactionRows(target, table, event, expected.subjectId);
    verifyRows(vitest, rows, event, expected, trace ? 'по traceId' : 'в транзакции');
}

function isTrace(target: DbTx | KitOutboxTrace): target is KitOutboxTrace {
    return 'app' in target && 'traceId' in target;
}

/** Строки текущей транзакции `tx` (`xmin = pg_current_xact_id()`). */
async function transactionRows(
    tx: DbTx,
    table: string,
    event: KitEvent,
    subjectId: string | undefined,
): Promise<OutboxRow[]> {
    const subject = subjectId === undefined ? sql`` : sql` and subject_id = ${subjectId}`;
    const { rows } = await tx.execute<OutboxRow>(
        sql`select id, subject_id, data from ${sql.raw(table)}
            where type = ${event.type} and version = ${event.version}
            and xmin = pg_current_xact_id()::xid${subject} order by seq`,
    );

    return rows;
}

/** Строки с `trace_id` после COMMIT: основной пул приложения, короткая транзакция с пустым тенантом. */
async function committedRows(
    { app, traceId }: KitOutboxTrace,
    table: string,
    event: KitEvent,
    subjectId: string | undefined,
): Promise<OutboxRow[]> {
    if (typeof traceId !== 'string' || traceId === '') {
        throw new TypeError('expectOutbox: traceId — непустая строка');
    }
    const client = await mainPoolOf(app.get(Db)).connect();
    try {
        await client.query('begin read only');
        // Пустой тенант — исключение строгой модели для outbox (OUTBOX_POLICY_SQL): видны строки всех компаний.
        await client.query("select set_config('app.tenant', '', true)");
        const params: unknown[] = [event.type, event.version, traceId];
        const subject = subjectId === undefined ? '' : ' and subject_id = $4';
        if (subjectId !== undefined) {
            params.push(subjectId);
        }
        const result = await client.query<OutboxRow>(
            `select id, subject_id, data from ${table}
             where type = $1 and version = $2 and trace_id = $3${subject} order by seq`,
            params,
        );
        await client.query('commit');

        return result.rows;
    } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

/** Общая проверка обеих форм: строка есть, `data` по схеме и по ожиданию; затем запись покрытия. */
function verifyRows<E extends KitEvent>(
    { expect, inject }: typeof Vitest,
    rows: readonly OutboxRow[],
    event: E,
    expected: ExpectedOutbox<E>,
    scope: string,
): void {
    const key = coverageKey(event);
    const where = expected.subjectId === undefined ? '' : ` (subjectId ${expected.subjectId})`;
    expect(rows, `expectOutbox: нет строки ${key}${where} ${scope}`).not.toHaveLength(0);
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
