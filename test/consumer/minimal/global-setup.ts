// globalSetup потребителя (AC-9.1, AC-3.8, AC-4.18): сборка сервиса tsc (dist/service) и PostgreSQL из TEST_IMAGES через
// startTestStack пакета — prepareDatabase и миграции drizzle/ (журнал consumer.__migrations).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTestStack } from '@verdeect/kit/testing';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TSC = fileURLToPath(new URL('./node_modules/typescript/bin/tsc', import.meta.url));

execFileSync(process.execPath, [TSC, '-p', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'inherit' });

export default startTestStack({ service: 'consumer', postgres: true, migrations: 'drizzle' });
