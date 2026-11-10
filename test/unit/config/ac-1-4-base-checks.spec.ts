// AC-1.4 (UC-3): withBaseChecks — PORT ≠ METRICS_PORT, SHUTDOWN_DRAIN_MS < SHUTDOWN_TIMEOUT_MS (prd.md §3.1).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEnv, envBase, parseEnv, withBaseChecks } from '../../../src/config/index.js';
import { errorOf } from './support.js';

const schema = defineEnv({ ...envBase });

describe('UC-3: проверки между ключами пакета', () => {
    it('AC-1.4: PORT = METRICS_PORT = 3000 → путь METRICS_PORT', () => {
        const error = errorOf(() => parseEnv(schema, { PORT: '3000', METRICS_PORT: '3000' }));

        expect(error.keys).toEqual(['METRICS_PORT']);
    });

    it('AC-1.4: PORT = METRICS_PORT = 0 → допустимо', () => {
        const env = parseEnv(schema, { PORT: '0', METRICS_PORT: '0' });

        expect(env.PORT).toBe(0);
        expect(env.METRICS_PORT).toBe(0);
    });

    it('AC-1.4: SHUTDOWN_DRAIN_MS = SHUTDOWN_TIMEOUT_MS → путь SHUTDOWN_DRAIN_MS', () => {
        const error = errorOf(() =>
            parseEnv(schema, { SHUTDOWN_DRAIN_MS: '5000', SHUTDOWN_TIMEOUT_MS: '5000' }),
        );

        expect(error.keys).toEqual(['SHUTDOWN_DRAIN_MS']);
    });

    it('AC-1.4: SHUTDOWN_DRAIN_MS > SHUTDOWN_TIMEOUT_MS → путь SHUTDOWN_DRAIN_MS', () => {
        const error = errorOf(() =>
            parseEnv(schema, { SHUTDOWN_DRAIN_MS: '20000', SHUTDOWN_TIMEOUT_MS: '10000' }),
        );

        expect(error.keys).toEqual(['SHUTDOWN_DRAIN_MS']);
    });

    it('AC-1.4: withBaseChecks на схеме без этих ключей — без ошибок', () => {
        const own = withBaseChecks(z.object({ NAME: z.string() }));

        expect(parseEnv(own, { NAME: 'x' })).toEqual({ NAME: 'x' });
        expect(own.shape.NAME).toBeDefined();
    });
});
