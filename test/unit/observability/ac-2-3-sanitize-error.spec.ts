// AC-2.3 (U, UC-4; NFR-4): sanitizeError — Drizzle и pg → только code, constraint, table, column, severity; ioredis — name,
// code, имя команды без аргументов; цепочка cause глубже 10 обрезается; зарегистрированная ветка сервиса применяется
// (prd.md §3.2). Перенос (inventory §2): I sanitize-error.spec.ts (DrizzleQueryError с email и хэшем, pg без Drizzle,
// обёрнутая дважды, стек без исходного сообщения, прочие ошибки не меняются, sanitizeLogObject), P/O sanitize-error.spec.ts;
// ioredis — по B sanitize-error.ts. Ошибки Drizzle и pg — объекты по форме, без импорта drizzle-orm и pg.
import { Writable } from 'node:stream';
import { pino, stdSerializers } from 'pino';
import { describe, expect, it } from 'vitest';
import { registerErrorSanitizer, sanitizeError } from '../../../src/observability/index.js';
import {
    MAX_CAUSE_DEPTH,
    SanitizedDbError,
    SanitizedRedisError,
    sanitizeLogObject,
    serializeError,
} from '../../../src/observability/sanitize-error.js';

const EMAIL = 'ivan@example.com';
const HASH = '$scrypt$N=65536,r=8,p=1$c2FsdA$aGFzaA';
const QUERY = 'insert into "svc"."account" ("id", "email", "password_hash") values ($1, $2, $3)';
const SECRETS = [EMAIL, HASH, QUERY, 'insert into', 'params:'];

function pgError(): Error {
    return Object.assign(
        new Error(`duplicate key value violates unique constraint "account_email_key" ${EMAIL}`),
        {
            name: 'error',
            severity: 'ERROR',
            code: '23505',
            constraint: 'account_email_key',
            table: 'account',
            column: 'email',
            detail: `Key (email)=(${EMAIL}) already exists.`,
            where: `SQL statement with ${EMAIL}`,
        },
    );
}

/** Форма DrizzleQueryError drizzle-orm 0.45: message с SQL и params, поля query, params, cause. */
function drizzleError(): Error {
    const params = ['0192-uuid', EMAIL, HASH];

    return Object.assign(
        new Error(`Failed query: ${QUERY}\nparams: ${params.join(',')}`, { cause: pgError() }),
        { name: 'DrizzleQueryError', query: QUERY, params },
    );
}

function redisError(): Error {
    return Object.assign(new Error(`ERR wrong type for session:${EMAIL}`), {
        name: 'ReplyError',
        code: 'WRONGTYPE',
        command: { name: 'hset', args: [`session:${EMAIL}`, 'token', HASH] },
    });
}

// pino напрямую и как в nestjs-pino: pino-http передаёт сериализатору уже сериализованный err.
const SERIALIZERS = {
    pino: serializeError,
    'pino-http': stdSerializers.wrapErrorSerializer(serializeError as never),
} as const;

function pinoOutput(err: unknown, via: keyof typeof SERIALIZERS): string {
    let output = '';
    const stream = new Writable({
        write(chunk: Buffer, _encoding, done) {
            output += chunk.toString();
            done();
        },
    });
    pino(
        { formatters: { log: sanitizeLogObject }, serializers: { err: SERIALIZERS[via] } },
        stream,
    ).error({ err }, 'command failed');

    return output;
}

function expectNoSecrets(text: string): void {
    for (const secret of SECRETS) {
        expect(text).not.toContain(secret);
    }
}

function chainDepth(error: unknown): number {
    let depth = 0;
    const seen = new Set<unknown>();
    for (let current = error; typeof current === 'object' && current !== null;) {
        if (seen.has(current)) {
            return Infinity;
        }
        seen.add(current);
        depth += 1;
        current = (current as { cause?: unknown }).cause;
    }

    return depth;
}

describe('UC-4: sanitizeError', () => {
    it('AC-2.3: ошибка Drizzle с params → только code, constraint, table, column, severity', () => {
        const sanitized = sanitizeError(drizzleError());

        expect(sanitized).toBeInstanceOf(SanitizedDbError);
        expect({ ...(sanitized as object) }).toEqual({
            name: 'SanitizedDbError',
            code: '23505',
            constraint: 'account_email_key',
            table: 'account',
            column: 'email',
            severity: 'ERROR',
        });
        expect((sanitized as Error).message).toBe('Failed query (23505)');
        expectNoSecrets(JSON.stringify(sanitized) + String((sanitized as Error).stack));
    });

    it('AC-2.3: ошибка pg с Key (…)=(…), обёрнутая дважды → без значений ключа', () => {
        const wrapped = new Error('outer', { cause: new Error('middle', { cause: pgError() }) });

        const sanitized = sanitizeError(wrapped) as SanitizedDbError;

        expect(sanitized).toBeInstanceOf(SanitizedDbError);
        expect(sanitized.code).toBe('23505');
        expect(JSON.stringify(sanitized) + String(sanitized.stack)).not.toContain(EMAIL);
    });

    it('AC-2.3: стек сохраняет кадры, но не исходное сообщение', () => {
        const error = drizzleError();

        const sanitized = sanitizeError(error) as Error;

        expect(sanitized.stack).toMatch(/^SanitizedDbError: Failed query \(23505\)\n {4}at /);
        expect(sanitized.stack).not.toContain('insert into');
    });

    it('AC-2.3: ioredis → name, code, имя команды без аргументов', () => {
        const sanitized = sanitizeError(new Error('outer', { cause: redisError() }));

        expect(sanitized).toBeInstanceOf(SanitizedRedisError);
        expect(sanitized).toMatchObject({
            name: 'SanitizedRedisError',
            code: 'WRONGTYPE',
            command: 'hset',
            message: 'Redis command failed (hset)',
        });
        const text = JSON.stringify(sanitized) + String((sanitized as Error).stack);
        expect(text).not.toContain(EMAIL);
        expect(text).not.toContain(HASH);
    });

    it('AC-2.3: цепочка cause глубже 10 обрезается, цикл не зацикливает', () => {
        let deep: Error = new Error('level-0');
        for (let index = 1; index < 15; index += 1) {
            deep = new Error(`level-${index}`, { cause: deep });
        }
        const cyclic = new Error('a');
        const other = new Error('b', { cause: cyclic });
        cyclic.cause = other;

        const truncated = sanitizeError(deep);
        const uncycled = sanitizeError(cyclic);

        expect(chainDepth(deep)).toBe(15);
        expect(chainDepth(truncated)).toBe(MAX_CAUSE_DEPTH);
        expect((truncated as Error).message).toBe('level-14');
        expect(truncated).toBeInstanceOf(Error);
        expect(chainDepth(uncycled)).toBe(2);
        expect(() => pinoOutput(cyclic, 'pino')).not.toThrow();
    });

    it('AC-2.3: зарегистрированная ветка сервиса применяется', () => {
        class SmtpError extends Error {
            readonly response = `550 ${EMAIL} unknown`;
        }
        const match = (error: unknown): boolean => error instanceof SmtpError;
        registerErrorSanitizer(match, () => new Error('SMTP failed'));
        registerErrorSanitizer(match, () => new Error('повторная регистрация игнорируется'));

        const sanitized = sanitizeError(new Error('send', { cause: new SmtpError('x') }));

        expect((sanitized as Error).message).toBe('SMTP failed');
        expect(sanitizeError(sanitized)).toBe(sanitized);
    });

    it('AC-2.3: прочие ошибки не меняются', () => {
        const error = Object.assign(new Error('plain'), { code: 'SERVICE_FAILED' });

        expect(sanitizeError(error)).toBe(error);
        expect(sanitizeError('text')).toBe('text');
        expect(sanitizeError(null)).toBeNull();
    });

    it.each(['pino', 'pino-http'] as const)(
        'AC-2.3: в выводе %s через serializeError нет SQL и параметров',
        (via) => {
            const output = pinoOutput(drizzleError(), via);

            expectNoSecrets(output);
            expect(JSON.parse(output)).toMatchObject({
                err: { type: 'SanitizedDbError', message: 'Failed query (23505)', code: '23505' },
            });
        },
    );

    it('AC-2.3: sanitizeLogObject очищает Error под любым ключом', () => {
        const result = sanitizeLogObject({ error: drizzleError(), other: 1 });

        expect(result.error).toBeInstanceOf(SanitizedDbError);
        expect(result.other).toBe(1);
    });
});
