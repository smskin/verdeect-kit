# Сброс очередей kit/kit.retry/kit.dlq перед стендами подписчика

**Date:** 2026-11-11 12:05
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** high

## Problem

Durable-очереди и привязки vhost воркера переживают файлы тестов; ac-5-9 (kit и kit.dlq пусты, нет привязок), ac-5-6/ac-5-17 (точные счётчики) зависели от порядка файлов

## Root Cause

План сбрасывал состояние БД (truncateFixtures), но не брокера; vhost создаётся один раз на прогон, bindQueue накапливается

## Solution

Task 21: помощник resetQueues() в test/support/messaging.ts; Tasks 26-28, 31, 34: вызов до создания стенда с subscriber; AC-5.19: resetQueues до объявления kit.retry с другим TTL

## Prevention

Для общего на прогон внешнего состояния (vhost, очереди, привязки) планировать сброс так же, как truncate для БД

## Tags

#test-isolation #rabbitmq #flaky
