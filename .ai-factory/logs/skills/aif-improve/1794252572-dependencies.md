# E1: задача 29 зависит от 9 и 23

**Date:** 2026-11-09 19:29
**Plan:** .ai-factory/plans/feature-e1-scaffold-config
**Severity:** low

## Problem

pack:check собирает пакет, а задача 29 зависела только от 27

## Root Cause

Зависимость от готового src выводилась из порядка фаз, а не задавалась явно

## Solution

Добавлены зависимости 9, 23 в index.md и пояснение в Cross-Phase Dependencies

## Prevention

Задачи, запускающие сборку, явно зависят от последних задач исходников

## Tags

#dependencies
