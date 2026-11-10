// AC-2.1 (U, UC-4; NFR-4, NFR-8): лог HTTP-запроса без значений SENSITIVE_KEYS на уровнях 0–2 и в заголовках, err.code
// виден, путь без query, /ok вне журнала доступа, base — service, entry, replica (prd.md §3.2). Перенос и обобщение
// (inventory §2): O ac-10-3-log-redaction.spec.ts (маркеры MARK_* отсутствуют в выводе) и observability.module.spec.ts;
// I observability.module.spec.ts («в логе запроса нет query-строки», «[Filtered]»); P observability.module.spec.ts
// (email и токены → [Filtered]); B observability.module.spec.ts («err.code остаётся видимым»).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    createLoggerOptions,
    SENSITIVE_KEYS,
    type KitRedaction,
} from '../../../src/observability/index.js';
import { accessLines, collector, LOGGER_ENV, startNestApp, withStream } from './support.js';

const REDACTION: KitRedaction = { sensitiveKeys: ['inn'] };
const HEADER_KEYS = ['authorization', 'cookie', 'set-cookie', 'idempotency-key'];

const output = collector();
let app: NestFastifyApplication;

/** Значение под именем name (`body.code` — вложенный путь) за depth обёртками. */
function nested(name: string, value: string, wrappers: readonly string[]): Record<string, unknown> {
    const path = [...wrappers, ...name.split('.')];

    return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<
        string,
        unknown
    >;
}

async function post(body: unknown, headers: Record<string, string> = {}) {
    return app
        .getHttpAdapter()
        .getInstance()
        .inject({
            method: 'POST',
            url: '/echo',
            headers: { 'content-type': 'application/json', ...headers },
            payload: JSON.stringify(body),
        });
}

async function get(url: string) {
    return app.getHttpAdapter().getInstance().inject({ method: 'GET', url });
}

beforeAll(async () => {
    const params = createLoggerOptions({
        service: 'kit-test',
        entry: 'http',
        env: LOGGER_ENV,
        redaction: REDACTION,
    });
    app = await startNestApp(withStream(params, output.stream));
});

afterAll(async () => {
    await app.close();
});

beforeEach(() => {
    output.clear();
});

describe('UC-4: лог HTTP-запроса без секретов и ПДн', () => {
    it.each(SENSITIVE_KEYS.map((name, index) => [name, index] as const))(
        'AC-2.1: %s на уровнях 0–2 в теле — значений нет',
        async (name, index) => {
            const markers = [0, 1, 2].map((depth) => `MARK_${index}_L${depth}`);
            const body = {
                ...nested(name, markers[0] ?? '', []),
                level1: nested(name, markers[1] ?? '', []),
                level2: { inner: nested(name, markers[2] ?? '', []) },
            };

            const response = await post(body);

            expect(response.statusCode).toBe(200);
            const text = output.text();
            expect(text).toContain('[Filtered]');
            for (const marker of markers) {
                expect(text).not.toContain(marker);
            }
        },
    );

    it.each(HEADER_KEYS)('AC-2.1: заголовок %s — значения нет в логе', async (name) => {
        const response = await post({ ok: true }, { [name]: `MARK_HEADER_${name}` });

        expect(response.statusCode).toBe(200);
        expect(output.text()).not.toContain(`MARK_HEADER_${name}`);
    });

    it('AC-2.1: err.code виден', () => {
        const lines = collector();
        const params = withStream(
            createLoggerOptions({ service: 'kit-test', entry: 'http', env: LOGGER_ENV }),
            lines.stream,
        );
        const logger = pino(...params.pinoHttp);

        logger.error(
            { err: Object.assign(new Error('отказ'), { code: 'SERVICE_FAILED' }) },
            'ошибка',
        );

        expect(lines.records()[0]).toMatchObject({ err: { code: 'SERVICE_FAILED' } });
    });

    it('AC-2.1: путь без query', async () => {
        await get('/items?email=MARK_QUERY_EMAIL&page=2');

        const [line] = accessLines(output.records());
        expect(line).toMatchObject({ req: { method: 'GET', url: '/items' } });
        expect(output.text()).not.toContain('MARK_QUERY_EMAIL');
    });

    it('AC-2.1: /ok вне журнала доступа', async () => {
        const response = await get('/ok');

        expect(response.statusCode).toBe(200);
        expect(accessLines(output.records())).toEqual([]);
    });

    it('AC-2.1: KitRedaction.sensitiveKeys дополняет базовый список, пустой массив его не отключает', async () => {
        await post({ inn: 'MARK_INN', email: 'MARK_EMAIL' });

        expect(output.text()).not.toContain('MARK_INN');
        expect(output.text()).not.toContain('MARK_EMAIL');

        const lines = collector();
        const params = withStream(
            createLoggerOptions({
                service: 'kit-test',
                entry: 'http',
                env: LOGGER_ENV,
                redaction: { sensitiveKeys: [] },
            }),
            lines.stream,
        );
        pino(...params.pinoHttp).info({ email: 'MARK_EMAIL_2', password: 'MARK_PASSWORD' }, 'x');

        expect(lines.text()).not.toContain('MARK_EMAIL_2');
        expect(lines.text()).not.toContain('MARK_PASSWORD');
    });

    it('AC-2.1: base содержит service, entry, replica (NFR-8)', async () => {
        await get('/items');

        const [line] = accessLines(output.records());
        expect(line).toMatchObject({
            service: 'kit-test',
            entry: 'http',
            replica: 'replica-test',
        });
    });
});
