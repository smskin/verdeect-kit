# E7: ожидания графа импортов /crypto и поддельный канал AC-5.13

**Date:** 2026-11-11 16:40
**Plan:** .ai-factory/plans/feature-e7-crypto.md
**Severity:** medium

## Problem

Тесты задач 7 и 10 требовали только node:crypto и zod, а fragments.ts импортирует node:os; поддельный канал без on/once упал бы TypeError

## Root Cause

Ожидания тестов писались без обхода фактических импортов зависимостей и вызовов в openChannel

## Solution

Разрешены node:* и zod; поддельный канал — EventEmitter с publish и waitForConfirms

## Prevention

Для тестов графа импортов проходить импорты переиспользуемых модулей; поддельные объекты сверять со всеми вызовами кода

## Tags

#tests #imports #mocks
