# rc.7: тип KitPools в pools.ts и условная строка README по AC-3.12

**Date:** 2026-11-13 11:54
**Plan:** .ai-factory/plans/fix-rc7-transition-findings.md
**Severity:** low

## Problem

13b не указывал место типа KitPools (нужен test/support/database.ts); 15 утверждал FST_ERR_CTP_ALREADY_PRESENT безусловно вопреки условию задачи 8

## Root Cause

Правки KT-77 внесены точечно без сверки зависимых задач

## Solution

KitPools объявлен в pools.ts с реэкспортом типа из модуля; README по факту теста 8

## Prevention

При переносе кода — перечислять переносимые типы и их потребителей; условия одной задачи отражать в зависимых

## Tags

#consistency #types
