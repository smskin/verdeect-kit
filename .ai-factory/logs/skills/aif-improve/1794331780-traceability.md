# AC-3.2 не прослеживался до теста фильтра

**Date:** 2026-11-10 17:29
**Plan:** .ai-factory/plans/feature-e3-http-framework.md
**Severity:** low

## Problem

Часть AC-3.2 (незарегистрированный код → 500, GlitchTip) проверяет тест задачи 6, но Traceability и заголовок задачи 6 его не называли

## Root Cause

Уточнение AC-3.2 из PRD v1.13 внесено в тест, но не в Traceability

## Solution

Задача 6 цитирует AC-3.2; строка Traceability — задачи 4, 6 и файл фильтра

## Prevention

После правки AC переносить новые случаи и в Traceability

## Tags

#traceability
