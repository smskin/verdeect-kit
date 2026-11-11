// Схема окружения процесса сервиса-потребителя (AC-9.1, AC-3.13): один объект — в main.ts (bootstrapService({env})) и в
// KitConfigModule.forRoot({schema}) AppModule, иначе KitConfigModule разберёт окружение повторно. AUTH_* — издатель
// токенов VerdeectAuthModule (forRootAsync через ConfigService).
import { defineEnv, envBase, envDatabase } from '@verdeect/kit/config';
import { z } from 'zod';

export const serviceEnvSchema = defineEnv({
    ...envBase,
    ...envDatabase,
    AUTH_ISSUER: z.string().min(1),
    AUTH_JWKS_URI: z.url(),
    AUTH_RESOURCE: z.string().min(1),
});
