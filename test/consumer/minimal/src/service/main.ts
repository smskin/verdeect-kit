// Точка входа сервиса-потребителя (AC-9.1; prd.md §3.5): node --import ./dist/service/instrument.js dist/service/main.js.
import 'reflect-metadata';
import { bootstrapService } from '@verdeect/kit/http';
import { AppModule } from './app.module.js';
import { serviceEnvSchema } from './env.js';

await bootstrapService({ module: AppModule, service: 'consumer', env: serviceEnvSchema });
