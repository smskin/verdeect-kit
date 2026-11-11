# Итерация 1 +check: существующие тесты AC-4.8 и worker-scope.test-d

**Date:** 2026-11-11 10:04
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** medium

## Problem

Случай AC-4.8 создавал kit.outbox, который теперь есть в фикстуре; type-тест workerScope проверял отсутствие rabbitmq

## Root Cause

План не сверял существующие тесты, проверяющие затронутые типы и таблицы

## Solution

Случай удалён в T7 и заменён в T31; type-тест обновлён в T12

## Prevention

Перед изменением типа или фикстуры искать тесты, которые его точно сравнивают

## Tags

#existing-tests #check
