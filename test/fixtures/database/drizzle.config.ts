// Конфиг drizzle-kit фикстуры БД пакета (pnpm db:fixtures); роли создаёт prepareDatabase, не миграции.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'postgresql',
    schema: './test/fixtures/database/schema.ts',
    out: './test/fixtures/database/migrations',
    schemaFilter: ['kit'],
    strict: true,
    verbose: true,
    entities: { roles: false },
});
