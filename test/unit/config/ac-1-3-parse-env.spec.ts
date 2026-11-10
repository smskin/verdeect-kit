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
});
