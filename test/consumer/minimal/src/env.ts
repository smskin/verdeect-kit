// Схема окружения потребителя (AC-9.1): фрагменты пакета + свой ключ.
import { defineEnv, envBase, envDatabase, envServiceUrls, positiveInt } from '@verdeect/kit/config';

export const envSchema = defineEnv({
    ...envBase,
    ...envDatabase,
    ...envServiceUrls(['identity']),
    FEATURE_LIMIT: positiveInt(5),
});
