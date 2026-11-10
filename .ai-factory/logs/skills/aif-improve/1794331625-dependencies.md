# Task 10 зависел от более поздней Task 11

**Date:** 2026-11-10 17:27
**Plan:** .ai-factory/plans/feature-e3-http-framework.md
**Severity:** low

## Problem

index.ts /http (фаза 3) зависел от @Api (фаза 4)

## Root Cause

Экспорт Api включён в index.ts без учёта порядка фаз

## Solution

Task 10 экспортирует всё, кроме Api; Task 11 дописывает экспорт и зависит от 10

## Prevention

Проверять, что зависимости указывают только на более ранние задачи

## Tags

#dependencies
