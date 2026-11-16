# Убрана круговая ссылка задач 17 и 18

**Date:** 2026-11-16 00:20
**Plan:** .ai-factory/plans/fix-rc10-orchestrator-findings.md
**Severity:** low

## Problem

Задача 17 копировала пример README из задачи 18, которая зависит от 17

## Root Cause

Источник примера выбран по месту в документе, а не по порядку задач

## Solution

Эталон — cli.ts потребителя (задача 17), README переносит его (задача 18)

## Prevention

Эталон артефакта — в задаче, которая идёт раньше

## Tags

#dependencies
