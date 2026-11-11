# Итерация 6 +check: поля Skill и тип outbox-event

**Date:** 2026-11-11 11:46
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** medium

## Problem

В задачах 2, 7, 19, 25, 26, 32, 33, 35, 36 были шаги правки index.ts, миграций, конфигов, документации и файлов потребителя без Skill; в задаче 35 был тип nestjs-code event (событие внутри процесса) вместо outbox-event; кроме того, в задаче 6 была испорченная фраза

## Root Cause

Skill ставился на основной файл задачи, а сопутствующие правки в том же шаге пропускались

## Solution

Добавлены поля Skill (generic/schema/migration/test/none); event заменён на outbox-event; фраза в задаче 6 исправлена

## Prevention

Ставить Skill на каждый файл в шаге, включая index.ts, конфиги и документацию

## Tags

#skill-attribution #check
