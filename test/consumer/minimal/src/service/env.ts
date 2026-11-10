// Схема окружения процесса сервиса-потребителя (AC-9.1, AC-3.13): один объект — в main.ts (bootstrapService({env})) и в
// KitConfigModule.forRoot({schema}) AppModule, иначе KitConfigModule разберёт окружение повторно.
import { defineEnv, envBase, envDatabase } from '@verdeect/kit/config';

export const serviceEnvSchema = defineEnv({ ...envBase, ...envDatabase });
