# Тест /health потребителя и регистрация LimitedController

**Date:** 2026-11-11 18:53
**Plan:** .ai-factory/plans/feature-e8-redis.md
**Severity:** medium

## Problem

Задача 17 добавляла пробу redis, но существующий toEqual-тест /health и опрос healthWithRabbit её не учитывали; LimitedController не регистрировался в AppModule

## Root Cause

План добавлял новый случай вместо проверки существующих точных сравнений, затронутых новым модулем

## Solution

Задача 17: расширить существующий тест /health на redis, опрос до redis up, LimitedController в controllers

## Prevention

При добавлении модуля в потребителя искать toEqual по составу /health и регистрацию новых контроллеров

## Tags

#consumer #health #existing-tests
