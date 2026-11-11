// drizzle-kit потребителя (AC-9.1): схема сервиса с @verdeect/kit/database и /idempotency; роли — prepareDatabase.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/service/schema.ts',
    out: './drizzle',
    schemaFilter: ['consumer'],
    strict: true,
    entities: { roles: false },
});
