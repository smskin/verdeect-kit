// AC-9.1 (UC-1, UC-16): минимальный проект-потребитель на упакованном архиве — /config и /testing.
import { once } from 'node:events';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { InvalidEnvironmentError, parseEnv } from '@verdeect/kit/config';
import { assertRepoConventions, TEST_IMAGES, TEST_TIMEOUT_SCALE } from '@verdeect/kit/testing';
import { describe, expect, inject, it } from 'vitest';
import { envSchema } from './env.js';

const SERVICE_URLS = '{"identity":"http://identity:3000"}';

function postgresUrl(): string {
    const url = inject('kitPostgresUrl');
    if (url === undefined) {
        return expect.fail('kitPostgresUrl не передан');
    }

    return url;
}

describe('UC-1: проект-потребитель', () => {
    it('AC-9.1: defineEnv разбирает окружение с адресом PostgreSQL из startTestStack', () => {
        const url = postgresUrl();

        const env = parseEnv(envSchema, { DATABASE_URL: url, SERVICE_URLS });

        expect(env.DATABASE_URL).toBe(url);
        expect(env.PORT).toBe(3000);
        expect(env.FEATURE_LIMIT).toBe(5);
    });

    it('AC-9.1: PostgreSQL из TEST_IMAGES доступен по TCP', async () => {
        const url = new URL(postgresUrl());
        const socket = connect(Number(url.port), url.hostname);

        await once(socket, 'connect');
        socket.destroy();
    });

    it('AC-9.1: assertRepoConventions проходит на фикстуре', () => {
        const root = fileURLToPath(new URL('../repo-fixture', import.meta.url));

        expect(() => assertRepoConventions({ root })).not.toThrow();
    });

    it('AC-9.1: InvalidEnvironmentError из пакета', () => {
        let caught: unknown;
        try {
            parseEnv(envSchema, { SERVICE_URLS });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(InvalidEnvironmentError);
        expect((caught as InvalidEnvironmentError).code).toBe('INVALID_ENVIRONMENT');
        expect((caught as InvalidEnvironmentError).keys).toContain('DATABASE_URL');
    });

    it('AC-9.1: TEST_IMAGES и TEST_TIMEOUT_SCALE доступны', () => {
        expect(TEST_IMAGES.postgres).toMatch(/^postgres:17\.11/);
        expect(TEST_TIMEOUT_SCALE).toBe(1);
    });
});
