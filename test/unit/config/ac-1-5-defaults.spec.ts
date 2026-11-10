// AC-1.5 (UC-1): умолчания фрагментов пакета (prd.md §3.1 v1.7); эталон — O env.schema.spec.ts.
import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
    defineEnv,
    envBase,
    envDatabase,
    envMessaging,
    envSentry,
    parseEnv,
} from '../../../src/config/index.js';
import { errorOf, expectKeysOnly } from './support.js';

const schema = defineEnv({ ...envBase, ...envDatabase });
const DB = { DATABASE_URL: 'postgres://x' };

describe('UC-1: умолчания окружения', () => {
    it('AC-1.5: умолчания', () => {
        expect(parseEnv(schema, DB)).toEqual({
            NODE_ENV: 'production',
            LOG_LEVEL: 'info',
            PORT: 3000,
            METRICS_PORT: 9100,
            REPLICA_ID: hostname(),
            SHUTDOWN_TIMEOUT_MS: 10_000,
            SHUTDOWN_DRAIN_MS: 0,
            DATABASE_URL: 'postgres://x',
            DB_POOL_MAX: 10,
            DB_POOL_ACQUIRE_TIMEOUT_MS: 5000,
        });
    });

    it('AC-1.5: DB_POOL_ACQUIRE_TIMEOUT_MS = 0 → путь DB_POOL_ACQUIRE_TIMEOUT_MS', () => {
        const error = errorOf(() => parseEnv(schema, { ...DB, DB_POOL_ACQUIRE_TIMEOUT_MS: '0' }));

        expect(error.keys).toEqual(['DB_POOL_ACQUIRE_TIMEOUT_MS']);
    });

    it('AC-1.5: REPLICA_ID вне ^[A-Za-z0-9._-]{1,128}$ → путь REPLICA_ID; пустой → hostname()', () => {
        const bad = 'replica/SECRET_MARKER_3';
        expectKeysOnly(
            errorOf(() => parseEnv(schema, { ...DB, REPLICA_ID: bad })),
            'REPLICA_ID',
            [bad],
        );
        expect(
            errorOf(() => parseEnv(schema, { ...DB, REPLICA_ID: 'a'.repeat(129) })).keys,
        ).toEqual(['REPLICA_ID']);
        expect(parseEnv(schema, { ...DB, REPLICA_ID: '  ' }).REPLICA_ID).toBe(hostname());
        expect(parseEnv(schema, { ...DB, REPLICA_ID: ' api-1 ' }).REPLICA_ID).toBe('api-1');
    });

    it('§3.1: RABBITMQ_RETRY_SECONDS — умолчание 30, 0 → ошибка', () => {
        const messaging = defineEnv({ ...envMessaging });
        const url = { RABBITMQ_URL: 'amqp://rabbit:5672' };

        expect(parseEnv(messaging, url).RABBITMQ_RETRY_SECONDS).toBe(30);
        expect(
            errorOf(() => parseEnv(messaging, { ...url, RABBITMQ_RETRY_SECONDS: '0' })).keys,
        ).toEqual(['RABBITMQ_RETRY_SECONDS']);
    });

    it('§3.1: LOG_LEVEL вне списка → ошибка; NODE_ENV вне списка → ошибка', () => {
        expect(errorOf(() => parseEnv(schema, { ...DB, LOG_LEVEL: 'verbose' })).keys).toEqual([
            'LOG_LEVEL',
        ]);
        expect(errorOf(() => parseEnv(schema, { ...DB, NODE_ENV: 'staging' })).keys).toEqual([
            'NODE_ENV',
        ]);
        expect(parseEnv(schema, { ...DB, LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe('silent');
    });

    it('§3.1: envSentry — пустые значения → null', () => {
        const sentry = defineEnv({ ...envBase, ...envSentry });

        const env = parseEnv(sentry, { SENTRY_DSN: '', SENTRY_ENVIRONMENT: '  ' });

        expect(env.SENTRY_DSN).toBeNull();
        expect(env.SENTRY_ENVIRONMENT).toBeNull();
        expect(env.SENTRY_RELEASE).toBeNull();
        expect(env.NODE_ENV).toBe('production');
    });
});
