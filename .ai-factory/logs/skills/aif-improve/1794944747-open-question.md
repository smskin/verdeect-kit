# Q1: PgCustomColumn (citext Identity) в закрытом списке курсора

**Date:** 2026-11-17 19:45
**Plan:** .ai-factory/plans/fix-rc12-identity-transition.md
**Severity:** high

## Problem

R8 делает customType ошибкой afterCursor; Identity сортирует account.email (citext) — список аккаунтов упал бы

## Root Cause

Закрытый список составлен по типам Drizzle без сверки с реальными столбцами сортировки сервисов

## Solution

Блокирующий вопрос Q1 в Requirements Reconciliation и в начале Task 6, строка «Как перейти» Task 11

## Prevention

Перед закрытием списка поддержанных типов — grep вызовов afterCursor в сервисах и типов их столбцов

## Tags

#open-question #keyset #consumer
