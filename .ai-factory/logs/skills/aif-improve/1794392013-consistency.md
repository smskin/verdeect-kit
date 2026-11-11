# Итерация 2 +check: проверка покрытия без outboxEvents, TestConsumer, AC-1.2 dedupe none

**Date:** 2026-11-11 10:13
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** high

## Problem

teardown падал без outboxEvents при KIT_OUTBOX_COVERAGE=1; TestConsumer не имел файла; случай AC-1.2 dedupe none был в файле без подмены

## Root Cause

Условия включения и общие тестовые компоненты не сверены с потребителями

## Solution

Условие outboxEvents && переменная + U-случай; TestConsumer в test/support/messaging.ts; случай перенесён в forroot-pg

## Prevention

Общие тестовые компоненты — в test/support с явным файлом; проверка «не требует X» — только при подменённом X

## Tags

#consistency #check
