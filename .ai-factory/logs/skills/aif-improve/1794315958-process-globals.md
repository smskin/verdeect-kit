# E2 после KT-10: сторож unref срабатывает в воркере Vitest

**Date:** 2026-11-10 13:05
**Plan:** .ai-factory/plans/feature-e2-observability.md
**Severity:** high

## Problem

После KT-10 п. 4 сторож после успешной остановки не снимается; в процессе Vitest он сработает к сроку и вызовет exit(1), а случай «в срок — exit не вызывается» стал неверным

## Root Cause

Решение о естественном выходе проверялось мыслью о production-процессе, а не о процессе тестов

## Solution

Задачи 17 и 19: каждый in-process тест ждёт срабатывания сторожа при подменённом process.exit; выход 0 проверяет только дочерний процесс; hasRef — через spy на setTimeout

## Prevention

Для таймеров, переживающих вызов (unref), планировать их уборку в тестах

## Tags

#test-setup #timers #process-globals
