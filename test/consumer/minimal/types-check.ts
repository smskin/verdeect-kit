// AC-1.1, AC-1.6: типы пакета (.d.ts архива) проверяются tsc потребителя.
import { defineEnv, envBase, parseEnv } from '@verdeect/kit/config';
import { z } from 'zod';

const schema = defineEnv({ ...envBase });
export const port: number = parseEnv(schema, {}).PORT;

// @ts-expect-error PORT пакета — число, строка несовместима (AC-1.6)
defineEnv({ ...envBase, PORT: z.string() });
