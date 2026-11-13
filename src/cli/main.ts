#!/usr/bin/env node
// CLI verdeect-kit (prd.md §3.5, §3.8, AC-3.7, AC-9.7; ARCHITECTURE.md «CLI»): точка входа bin — только вызов runCli
// (разбор, справка и загрузка обработчика — run.ts). Результат — JSON в stdout, ошибка — JSON и код выхода 1.
// process.exit не вызывается: его вызывают только failStartup и сторож KitLifecycle; код выхода — process.exitCode.
import 'reflect-metadata';
import { runCli } from './run.js';

process.exitCode = await runCli(process.argv.slice(2), {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
});
