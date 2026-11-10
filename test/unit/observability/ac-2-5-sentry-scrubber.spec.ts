// AC-2.5 (U, UC-4; NFR-4): событие GlitchTip без query (в том числе в request.url), без request.data, user только с id,
// без хвоста params: и Key (…)=(…) в тексте исключения; имена SENSITIVE_KEYS и KitRedaction.sensitiveKeys → [Filtered].
// AC-2.12: maskPath — к request.url события (prd.md §3.2). Перенос: I/O sentry-scrubber.spec.ts ([Filtered] в extra,
// contexts, breadcrumbs; удаление cookies, data, заголовков; user → id; глубина 8 без исключения).
import type { Event } from '@sentry/nestjs';
import { describe, expect, it } from 'vitest';
import type { KitRedaction } from '../../../src/observability/index.js';
import { scrubBreadcrumb, scrubEvent } from '../../../src/observability/sentry.js';

const REDACTION: KitRedaction = {
    sensitiveKeys: ['inn'],
    maskPath: (path) => path.replace(/^\/share\/[^/]+/, '/share/***'),
};

function event(overrides: Partial<Event> = {}): Event {
    return {
        request: {
            url: 'https://api.example.test/v1/items?email=MARK_QUERY#frag',
            query_string: 'email=MARK_QUERY_STRING',
            data: { password: 'MARK_DATA' },
            cookies: { session: 'MARK_COOKIE' },
            headers: {
                authorization: 'Bearer MARK_AUTH',
                cookie: 'sid=MARK_COOKIE_HEADER',
                'set-cookie': 'sid=MARK_SET_COOKIE',
                'x-forwarded-for': '10.0.0.1',
                'idempotency-key': 'MARK_IDEMPOTENCY',
                accept: 'application/json',
            },
        },
        ...overrides,
    };
}

describe('UC-4: скраббер событий GlitchTip', () => {
    it('AC-2.5: query удалён из request.url и query_string', () => {
        const scrubbed = scrubEvent(event(), undefined);

        expect(scrubbed.request?.url).toBe('https://api.example.test/v1/items');
        expect(scrubbed.request?.query_string).toBeUndefined();
        expect(JSON.stringify(scrubbed)).not.toContain('MARK_QUERY');
    });

    it('AC-2.5: request.data и cookies удалены, заголовки authorization, cookie, set-cookie, x-forwarded-for — тоже', () => {
        const scrubbed = scrubEvent(event(), undefined);

        expect(scrubbed.request?.data).toBeUndefined();
        expect(scrubbed.request?.cookies).toBeUndefined();
        expect(scrubbed.request?.headers).toEqual({
            'idempotency-key': '[Filtered]',
            accept: 'application/json',
        });
        expect(JSON.stringify(scrubbed)).not.toMatch(/MARK_|10\.0\.0\.1/);
    });

    it('AC-2.5: user только с id', () => {
        const scrubbed = scrubEvent(
            event({ user: { id: 'acc_1', email: 'MARK_EMAIL', ip_address: '10.0.0.2' } }),
            undefined,
        );

        expect(scrubbed.user).toEqual({ id: 'acc_1' });
        expect(scrubEvent({ user: { email: 'MARK_EMAIL' } }, undefined).user).toEqual({});
    });

    it('AC-2.5: хвост params: и Key (…)=(…) вычищены из текста исключения', () => {
        const scrubbed = scrubEvent(
            {
                exception: {
                    values: [
                        { type: 'Error', value: 'Key (email)=(MARK_KEY) already exists.' },
                        { type: 'Error', value: 'Failed query: select 1\nparams: MARK_PARAMS' },
                    ],
                },
            },
            new Error('plain'),
        );

        expect(scrubbed.exception?.values?.map((value) => value.value)).toEqual([
            'Key [Filtered] already exists.',
            'Failed query: select 1',
        ]);
    });

    it('AC-2.5: ошибка БД — сообщение sanitizeError во всех values', () => {
        const pg = Object.assign(new Error('Key (email)=(MARK_PG)'), {
            code: '23505',
            severity: 'ERROR',
        });

        const scrubbed = scrubEvent(
            { exception: { values: [{ value: pg.message }, { value: 'outer MARK_SQL' }] } },
            new Error('outer MARK_SQL', { cause: pg }),
        );

        expect(scrubbed.exception?.values?.map((value) => value.value)).toEqual([
            'Failed query (23505)',
            'Failed query (23505)',
        ]);
    });

    it('AC-2.5: ошибка ioredis — ключи Redis из текста ответа не попадают в событие (NFR-4)', () => {
        const redis = Object.assign(
            new Error("ERR unknown command 'x', with args beginning with: 'session:MARK_KEY'"),
            { name: 'ReplyError', command: { name: 'x', args: ['session:MARK_KEY'] } },
        );

        const scrubbed = scrubEvent(
            { exception: { values: [{ value: redis.message }, { value: 'outer' }] } },
            new Error('outer', { cause: redis }),
        );

        expect(scrubbed.exception?.values?.map((value) => value.value)).toEqual([
            'Redis command failed (x)',
            'Redis command failed (x)',
        ]);
        expect(JSON.stringify(scrubbed)).not.toContain('MARK_KEY');
    });

    it('AC-2.5: имена SENSITIVE_KEYS и KitRedaction.sensitiveKeys → [Filtered] в extra, contexts, breadcrumbs', () => {
        const scrubbed = scrubEvent(
            {
                extra: { Password: 'MARK_1', nested: { inn: 'MARK_2' }, code: 'KEEP_CODE' },
                contexts: { body: { code: 'MARK_3', state: 'MARK_4' }, app: { token: 'MARK_5' } },
                tags: { accessToken: 'MARK_6' },
                breadcrumbs: [{ data: { email: 'MARK_7', url: '/share/MARK_8?x=MARK_9' } }],
            },
            undefined,
            REDACTION,
        );

        const text = JSON.stringify(scrubbed);
        expect(text).not.toMatch(/MARK_/);
        expect(text).toContain('KEEP_CODE');
        expect(scrubbed.extra).toMatchObject({
            Password: '[Filtered]',
            nested: { inn: '[Filtered]' },
        });
        expect(scrubbed.breadcrumbs?.[0]?.data?.url).toBe('/share/***');
    });

    it('AC-2.5: глубина больше 8 — [Truncated] без исключения', () => {
        let deep: Record<string, unknown> = { value: 'leaf' };
        for (let index = 0; index < 12; index += 1) {
            deep = { level: deep };
        }

        const scrubbed = scrubEvent({ extra: deep }, undefined);

        expect(JSON.stringify(scrubbed)).toContain('[Truncated]');
    });

    it('AC-2.12: maskPath применяется к request.url события', () => {
        const scrubbed = scrubEvent(
            event({ request: { url: 'https://api.example.test/share/MARK_SHARE/view?x=1' } }),
            undefined,
            REDACTION,
        );

        expect(scrubbed.request?.url).toBe('https://api.example.test/share/***/view');
    });

    it('§3.2: scrubBreadcrumb без data — без изменений', () => {
        const crumb = { message: 'x' };

        expect(scrubBreadcrumb(crumb)).toBe(crumb);
    });
});
