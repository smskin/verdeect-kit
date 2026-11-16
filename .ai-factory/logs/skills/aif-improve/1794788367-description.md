# Уточнены задачи 9 и 10 по коду

**Date:** 2026-11-16 00:19
**Plan:** .ai-factory/plans/fix-rc10-orchestrator-findings.md
**Severity:** low

## Problem

Задача 10 содержала непроверенную оговорку о конструкторе RabbitConnection, задача 9 — неточный SQL замка теста

## Root Cause

Допущения не сверены с rabbit-connection.ts:303 и run-exclusive.ts:32 при составлении плана

## Solution

Оговорка убрана; SQL замка — pg_advisory_lock(hashtextextended($1, 0))

## Prevention

Сверять сигнатуры и SQL с файлами до записи задачи

## Tags

#description #verified-assumption
