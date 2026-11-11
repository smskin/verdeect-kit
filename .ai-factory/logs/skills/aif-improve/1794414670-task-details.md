# Уточнения задач 2, 4, 5, 10 плана E7

**Date:** 2026-11-11 16:31
**Plan:** .ai-factory/plans/feature-e7-crypto.md
**Severity:** low

## Problem

Оговорка про COMMON_PATTERNS в ESLint, литеральный -- в pnpm test:timing, изменяемый тип keys, нет импорта DecryptErrorReason в types-check

## Root Cause

План писался до сверки с eslint.config.js restrictedImports и без проверки readonly-типов публичных опций

## Solution

restrictedImports([...]) без повтора групп; команда без --; keys — readonly массив readonly объектов; импорт типа добавлен

## Prevention

Сверять задачи ESLint с функцией restrictedImports; публичные опции — readonly; в types-check импортировать каждый используемый тип

## Tags

#eslint #types #command
