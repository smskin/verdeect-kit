# Условные шаги заменены фактами кода

**Date:** 2026-11-11 08:52
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** medium

## Problem

Задачи 4, 7, 8, 11, 12, 17, 23, 32 содержали ветки «если … сверить» по фактам, которые можно проверить при планировании

## Root Cause

План писался до сверки отдельных файлов (tenant.ts, 0001_force_grants.sql, vitest-конфиги, Makefile, ci.yml, fail-startup.ts)

## Solution

Ветки заменены проверенными фактами; добавлен случай worker-scope.spec.ts

## Prevention

Проверять grep-ом каждое допущение о существующем коде до записи шага

## Tags

#unverified-assumption #ultra-detail-gate
