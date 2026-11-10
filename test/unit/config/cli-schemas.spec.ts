// Схемы окружения CLI (prd.md §3.1); эталон — O env.schema.spec.ts (MigrateEnvSchema, PrepareEnvSchema).
import { describe, expect, it } from 'vitest';
import { migrateEnvSchema, parseEnv, prepareEnvSchema } from '../../../src/config/index.js';
import { errorOf, expectKeysOnly } from './support.js';

describe('§3.1: схемы CLI', () => {
    it('§3.1: prepareEnvSchema — пароль короче 16 → путь DB_OWNER_PASSWORD, пароль не в тексте', () => {
        const short = 'short-SECRET';

        const error = errorOf(() =>
            parseEnv(prepareEnvSchema, {
                DATABASE_ADMIN_URL: 'postgres://admin@db/postgres',
                DB_OWNER_PASSWORD: short,
                DB_APP_PASSWORD: 'app-password-0123456789',
            }),
        );

        expect(error.keys).toEqual(['DB_OWNER_PASSWORD']);
        expectKeysOnly(error, 'DB_OWNER_PASSWORD', [short, 'app-password-0123456789']);
    });

    it('§3.1: migrateEnvSchema без DATABASE_MIGRATOR_URL → путь DATABASE_MIGRATOR_URL', () => {
        expect(errorOf(() => parseEnv(migrateEnvSchema, {})).keys).toEqual([
            'DATABASE_MIGRATOR_URL',
        ]);
        expect(parseEnv(migrateEnvSchema, { DATABASE_MIGRATOR_URL: 'postgres://o@db/x' })).toEqual({
            DATABASE_MIGRATOR_URL: 'postgres://o@db/x',
            LOG_LEVEL: 'info',
        });
    });
});
