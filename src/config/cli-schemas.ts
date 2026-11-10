// Схемы окружения CLI (prd.md §3.1); эталон — O env.schema.ts MigrateEnvSchema/PrepareEnvSchema, имена паролей — §3.1.
import { z } from 'zod';
import { logLevel } from './fragments.js';

/** Окружение CLI `db migrate`: адрес БД роли-владельца схемы (§3.1). */
export const migrateEnvSchema = z.object({
    DATABASE_MIGRATOR_URL: z.string().min(1),
    LOG_LEVEL: logLevel,
});

/** Окружение CLI `db prepare`: суперпользователь и пароли ролей (§3.1). */
export const prepareEnvSchema = z.object({
    DATABASE_ADMIN_URL: z.string().min(1),
    DB_OWNER_PASSWORD: z.string().min(16),
    DB_APP_PASSWORD: z.string().min(16),
    LOG_LEVEL: logLevel,
});
