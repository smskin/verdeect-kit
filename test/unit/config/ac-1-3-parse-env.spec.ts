// AC-1.3 (UC-3): parseEnv — полный путь ключа через точку, (root) без пути, значений нет (prd.md §3.1, NFR-4).
// Эталон — B env.schema.spec.ts (AC-6.6), обобщён на фрагменты пакета.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    defineEnv,
    envBase,
    envServiceUrls,
    InvalidEnvironmentError,
    jsonValue,
    parseEnv,
} from '../../../src/config/index.js';
import { errorOf, expectKeysOnly } from './support.js';

describe('UC-3: разбор окружения', () => {
    it('AC-1.3: SERVICE_URLS.files не URL → путь SERVICE_URLS.files, секрет не в тексте', () => {
        const secret = 'not-a-url-SECRET_MARKER_1';
        const schema = defineEnv({ ...envServiceUrls(['files']) });

        const error = errorOf(() =>
            parseEnv(schema, { SERVICE_URLS: JSON.stringify({ files: secret }) }),
        );

        expectKeysOnly(error, 'SERVICE_URLS.files', [secret]);
    });

    it('AC-1.3: NODES.2.host → полный путь', () => {
        const schema = defineEnv({
            NODES: jsonValue(z.array(z.object({ host: z.string().min(1) }))),
        });
        const nodes = [{ host: 'a-SECRET_MARKER_2' }, { host: 'b' }, { host: '' }];

        const error = errorOf(() => parseEnv(schema, { NODES: JSON.stringify(nodes) }));

        expect(error.keys).toEqual(['NODES.2.host']);
        expectKeysOnly(error, 'NODES.2.host', ['SECRET_MARKER_2']);
    });

    it('AC-1.3: ошибка без пути → (root)', () => {
        const schema = defineEnv({}, (_, ctx) => {
            ctx.addIssue({ code: 'custom', message: 'x', input: '' });
        });

        const error = errorOf(() => parseEnv(schema, {}));

        expect(error.keys).toEqual(['(root)']);
    });

    it('AC-1.3: InvalidEnvironmentError — code INVALID_ENVIRONMENT, name, сообщение «Неверное окружение: …»', () => {
        const error = errorOf(() => parseEnv(defineEnv({ ...envBase }), { PORT: 'abc' }));

        expect(error).toBeInstanceOf(InvalidEnvironmentError);
        expect(error.code).toBe('INVALID_ENVIRONMENT');
        expect(error.name).toBe('InvalidEnvironmentError');
        expect(error.message).toBe('Неверное окружение: PORT');
        expect(error.cause).toBeUndefined();
        const issue = error.issues[0];
        expect(issue?.key).toBe('PORT');
        expect(issue?.message).not.toBe('');
        expect(error.message).not.toContain(issue?.message);
    });

    it('AC-1.3: несколько ошибок — ключи без дублей', () => {
        const schema = defineEnv({
            ...envBase,
            LIST: jsonValue(
                z.array(
                    z
                        .string()
                        .min(3)
                        .regex(/^[a-z]+$/),
                ),
            ),
        });

        const error = errorOf(() =>
            parseEnv(schema, { PORT: 'x', LOG_LEVEL: 'loud', LIST: JSON.stringify(['A1']) }),
        );

        // Порядок — порядок issues (ключи схемы); у LIST.0 два issue (min и regex) → один ключ.
        expect(error.keys).toEqual(['LOG_LEVEL', 'PORT', 'LIST.0']);
        expect(new Set(error.keys).size).toBe(error.keys.length);
        expectKeysOnly(error, 'LOG_LEVEL', ['loud', 'A1']);
    });

    it("AC-1.3: z.undefined({error: 'IDENTITY_PORT заменён на PORT'}) → issues [{key: 'IDENTITY_PORT', message: 'IDENTITY_PORT заменён на PORT'}]", () => {
        const schema = defineEnv({
            IDENTITY_PORT: z.undefined({ error: 'IDENTITY_PORT заменён на PORT' }),
        });

        const error = errorOf(() => parseEnv(schema, { IDENTITY_PORT: '3000' }));

        expect(error.keys).toEqual(['IDENTITY_PORT']);
        expect(error.issues).toEqual([
            { key: 'IDENTITY_PORT', message: 'IDENTITY_PORT заменён на PORT' },
        ]);
    });

    it('AC-1.3: superRefine с текстом, содержащим значение ключа (≥ 8 символов) → message «неверное значение (custom)», значения нет в message, keys, issues и JSON.stringify(error)', () => {
        const url = 'postgres://u:SECRET_MARKER_9@h/db';
        const schema = defineEnv({ DATABASE_URL: z.string() }, (env, ctx) => {
            ctx.addIssue({
                code: 'custom',
                path: ['DATABASE_URL'],
                message: `плохой адрес ${env.DATABASE_URL.slice(13, 21)}`,
                input: '',
            });
        });

        const error = errorOf(() => parseEnv(schema, { DATABASE_URL: url }));

        expect(error.issues).toEqual([
            { key: 'DATABASE_URL', message: 'неверное значение (custom)' },
        ]);
        expectKeysOnly(error, 'DATABASE_URL', ['SECRET_M', 'SECRET_MARKER_9']);
        expect(JSON.stringify(error)).not.toContain('SECRET_M');
    });

    it('AC-1.3: ошибка уровня корня с фрагментом значения любого ключа → key (root), message заменён', () => {
        const schema = defineEnv({ REDIS_URL: z.string() }, (env, ctx) => {
            ctx.addIssue({
                code: 'custom',
                message: `redis ${env.REDIS_URL.slice(8, 16)} недоступен`,
                input: '',
            });
        });

        const error = errorOf(() =>
            parseEnv(schema, { REDIS_URL: 'redis://SECRET_MARKER_R@h:6379' }),
        );

        expect(error.issues).toEqual([{ key: '(root)', message: 'неверное значение (custom)' }]);
        expectKeysOnly(error, '(root)', ['SECRET_M']);
    });

    it('AC-1.3: ошибка уровня корня — сверка только со значениями ключей схемы: значение чужой переменной (NODE_ENV=production) в тексте не заменяется, значение ключа схемы — заменяется', () => {
        const schema = defineEnv({ MAIL_DSN: z.string() }, (env, ctx) => {
            const message =
                env.MAIL_DSN === ''
                    ? 'MAIL_DSN обязателен в production'
                    : `MAIL_DSN ${env.MAIL_DSN} не принят`;
            ctx.addIssue({ code: 'custom', message, input: '' });
        });
        const foreign = { NODE_ENV: 'production', OTHER_VAR: 'обязателен в production' };

        const kept = errorOf(() => parseEnv(schema, { ...foreign, MAIL_DSN: '' }));
        const replaced = errorOf(() =>
            parseEnv(schema, { ...foreign, MAIL_DSN: 'smtp://SECRET_MARKER_M@h' }),
        );

        expect(kept.issues).toEqual([
            { key: '(root)', message: 'MAIL_DSN обязателен в production' },
        ]);
        expect(replaced.issues).toEqual([{ key: '(root)', message: 'неверное значение (custom)' }]);
    });

    it('AC-1.3: значение короче 8 символов в message — message схемы без замены', () => {
        // Ключ сервиса, не PORT: у PORT пакета выход — число (AC-1.6).
        const schema = defineEnv({ WORKERS: z.string() }, (env, ctx) => {
            ctx.addIssue({
                code: 'custom',
                path: ['WORKERS'],
                message: `WORKERS ${env.WORKERS} — не число`,
                input: '',
            });
        });

        const error = errorOf(() => parseEnv(schema, { WORKERS: 'abc' }));

        expect(error.issues).toEqual([{ key: 'WORKERS', message: 'WORKERS abc — не число' }]);
    });

    it('AC-1.3: несколько issue одного ключа — запись на каждый issue, keys без дублей', () => {
        const schema = defineEnv({
            LIST: jsonValue(
                z.array(
                    z
                        .string()
                        .min(3)
                        .regex(/^[a-z]+$/),
                ),
            ),
        });

        const error = errorOf(() => parseEnv(schema, { LIST: JSON.stringify(['A1']) }));

        expect(error.keys).toEqual(['LIST.0']);
        expect(error.issues.map((issue) => issue.key)).toEqual(['LIST.0', 'LIST.0']);
        for (const issue of error.issues) {
            expect(issue.message).not.toBe('');
            expect(issue.message).not.toContain('A1');
        }
    });
});
