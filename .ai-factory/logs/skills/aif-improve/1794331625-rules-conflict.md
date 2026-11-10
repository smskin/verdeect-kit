# CLI и помощники /testing — без process.exit и без peer vitest

**Date:** 2026-11-10 17:27
**Plan:** .ai-factory/plans/feature-e3-http-framework.md
**Severity:** medium

## Problem

CLI планировал выход через process.exit и spy в тестах; expectProblem грузил vitest через loadPeer со ссылкой на несуществующий образец; ARCHITECTURE не знала ajv и @nestjs/testing; закрытие Fastify описано с лишним запасным путём; лог портов давал 0

## Root Cause

План писался без сверки с запретами ARCHITECTURE (process.exit) и фактическим кодом /testing и Nest FastifyAdapter

## Solution

CLI возвращает код и ставит process.exitCode; окружение логгера через envBase; node:assert/strict в помощниках; правка таблицы зависимостей ARCHITECTURE; закрытие Fastify — по факту адаптера; лог фактических портов

## Prevention

Сверять задачи с запретами ARCHITECTURE и кодом node_modules, на который опирается допущение

## Tags

#description #architecture #cli
