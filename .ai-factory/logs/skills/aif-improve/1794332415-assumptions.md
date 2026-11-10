# Несверенные допущения о коде и порядке задач

**Date:** 2026-11-10 17:40
**Plan:** .ai-factory/plans/feature-e3-http-framework.md
**Severity:** high

## Problem

tokens.ts создавался позже потребителя; пути сборки потребителя расходились; fake-sentry без redaction; SENTRY_DSN читался из схемы без envSentry; ключи Require* не экспортируются @verdeect/auth; тест манифеста E1 запрещал bin

## Root Cause

План опирался на ожидаемый вид кода, не проверяя файлы node_modules, тестовые обвязки и существующие тесты

## Solution

tokens.ts — в задаче 6; rootDir/noEmit и единые пути dist/service; initFakeSentry({redaction}); DSN через envSentry; строковые ключи Require* и GUARDS_METADATA; MODIFY случаев манифеста

## Prevention

Для каждой задачи проверять существование используемых файлов и экспортов, и существующие тесты, которые задача ломает

## Tags

#assumptions #dependencies #tests
