// AC-1.11 (UC-1): envServiceUrls — обязательные имена, лишние имена допустимы, путь SERVICE_URLS.<имя>
// (prd.md §3.1, NFR-4); эталон — B env.schema.ts serviceUrls (catchall).
import { describe, expect, it } from 'vitest';
import { defineEnv, envServiceUrls, parseEnv } from '../../../src/config/index.js';
import { errorOf, expectKeysOnly } from './support.js';

const schema = defineEnv({ ...envServiceUrls(['identity']) });

function urls(map: Record<string, string>): { SERVICE_URLS: string } {
    return { SERVICE_URLS: JSON.stringify(map) };
}

describe('UC-1: адреса других сервисов', () => {
    it('AC-1.11: нет identity → путь SERVICE_URLS.identity', () => {
        const error = errorOf(() => parseEnv(schema, urls({ web: 'http://web-host:8080' })));

        expectKeysOnly(error, 'SERVICE_URLS.identity', ['web-host']);
    });

    it('AC-1.11: identity не URL → путь SERVICE_URLS.identity, значение не в тексте', () => {
        const value = 'identity-SECRET_MARKER_4';

        expectKeysOnly(
            errorOf(() => parseEnv(schema, urls({ identity: value }))),
            'SERVICE_URLS.identity',
            [value],
        );
    });

    it('AC-1.11: лишние имена допустимы', () => {
        const env = parseEnv(
            schema,
            urls({ identity: 'http://identity:3000', files: 'https://files.local' }),
        );

        expect(env.SERVICE_URLS).toEqual({
            identity: 'http://identity:3000',
            files: 'https://files.local',
        });
    });

    it('AC-1.11: лишнее имя не URL → путь SERVICE_URLS.<имя>', () => {
        const error = errorOf(() =>
            parseEnv(schema, urls({ identity: 'http://identity:3000', files: 'ftp://files' })),
        );

        expect(error.keys).toEqual(['SERVICE_URLS.files']);
    });

    it('AC-1.11: SERVICE_URLS не JSON → путь SERVICE_URLS', () => {
        const value = '{identity: SECRET_MARKER_5';

        expectKeysOnly(
            errorOf(() => parseEnv(schema, { SERVICE_URLS: value })),
            'SERVICE_URLS',
            ['SECRET_MARKER_5'],
        );
    });
});
