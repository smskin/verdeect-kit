# Тест с initFakeSentry в isolated

**Date:** 2026-11-13 18:32
**Plan:** .ai-factory/plans/fix-rc8-transition-findings.md
**Severity:** medium

## Problem

1a добавлял initFakeSentry в файл из shared-проекта

## Root Cause

Список ISOLATED в vitest.integration.config.ts не проверен

## Solution

DLQ-случай вынесен в ac-5-22-unknown-version-dlq.spec.ts и добавлен в ISOLATED

## Prevention

Тест с процесс-глобальным состоянием — сразу в отдельный файл и в ISOLATED

## Tags

#tests #isolation
